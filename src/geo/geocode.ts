import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { PoliteFetcher, RobotsDisallowedError } from "../http/politeFetch.js";

export const GeocodeConfigSchema = z.object({
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  cacheDays: z.number().nonnegative(),
  parcels: z.object({ url: z.string(), pinField: z.string() }),
  census: z.object({ url: z.string(), benchmark: z.string() }),
  nominatim: z.object({ enabled: z.boolean(), url: z.string(), minIntervalMs: z.number().int().positive() }),
});
export type GeocodeConfig = z.infer<typeof GeocodeConfigSchema>;

export function loadGeocodeConfig(path = "config/geocode.yaml"): GeocodeConfig {
  return GeocodeConfigSchema.parse(parse(readFileSync(path, "utf8")));
}

export type GeocodeMethod = "pin" | "census" | "nominatim";

export interface GeocodeResult {
  lat: number;
  lng: number;
  method: GeocodeMethod;
  /** The PINs or address query that produced the point. */
  matched: string;
}

/** What a geocoder needs from a civic action. */
export interface Locatable {
  municipality: string;
  addresses: string[];
  parcel_pins: string[];
}

interface ArcgisResponse {
  features?: { attributes: Record<string, unknown>; geometry?: { rings?: number[][][] } }[];
  error?: { message?: string };
}

interface CensusResponse {
  result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number } }[] };
}

type NominatimResponse = { lat: string; lon: string; display_name: string }[];

/**
 * Places an action on the map: parcel centroid(s) from its PINs, else its first address via
 * the Census geocoder, else Nominatim. Returns null when nothing in Wake County matches;
 * those items stay in the feed without a map pin.
 */
export class Geocoder {
  private readonly http: PoliteFetcher;
  private readonly nominatimHttp: PoliteFetcher;
  readonly warnings: string[] = [];

  constructor(
    private readonly cfg: GeocodeConfig,
    opts: { http?: PoliteFetcher; nominatimHttp?: PoliteFetcher } = {},
  ) {
    const maxAgeMs = cfg.cacheDays * 86_400_000;
    this.http = opts.http ?? new PoliteFetcher({ maxAgeMs });
    this.nominatimHttp = opts.nominatimHttp ?? new PoliteFetcher({ maxAgeMs, minIntervalMs: cfg.nominatim.minIntervalMs });
  }

  async geocode(item: Locatable): Promise<GeocodeResult | null> {
    const pins = item.parcel_pins.map(normalizePin).filter((p): p is string => p !== null);
    if (pins.length) {
      const hit = await this.tryStep("parcels", () => this.byPins(pins));
      if (hit) return hit;
    }
    for (const address of item.addresses) {
      const query = addressQuery(address, item.municipality);
      if (!query) continue;
      const hit =
        (await this.tryStep("census", () => this.byCensus(query))) ??
        (this.cfg.nominatim.enabled ? await this.tryStep("nominatim", () => this.byNominatim(query)) : null);
      if (hit) return hit;
    }
    return null;
  }

  private async byPins(pins: string[]): Promise<GeocodeResult | null> {
    const { url, pinField } = this.cfg.parcels;
    const params = new URLSearchParams({
      where: `${pinField} IN (${pins.map((p) => `'${p}'`).join(",")})`,
      outFields: pinField,
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
    });
    const res = await this.http.getJson<ArcgisResponse>(`${url}?${params}`);
    if (res.error) throw new Error(res.error.message ?? "ArcGIS error");
    const points = (res.features ?? [])
      .map((f) => (f.geometry?.rings ? ringsCentroid(f.geometry.rings) : null))
      .filter((p): p is [number, number] => p !== null && this.inBounds(p[0], p[1]));
    if (!points.length) return null;
    const lng = points.reduce((s, p) => s + p[0], 0) / points.length;
    const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
    return { lat, lng, method: "pin", matched: pins.join(",") };
  }

  private async byCensus(query: string): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({ address: query, benchmark: this.cfg.census.benchmark, format: "json" });
    const res = await this.http.getJson<CensusResponse>(`${this.cfg.census.url}?${params}`);
    const m = res.result?.addressMatches?.find((a) => this.inBounds(a.coordinates.x, a.coordinates.y));
    return m ? { lat: m.coordinates.y, lng: m.coordinates.x, method: "census", matched: query } : null;
  }

  private async byNominatim(query: string): Promise<GeocodeResult | null> {
    const [minLng, minLat, maxLng, maxLat] = this.cfg.bounds;
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "1",
      countrycodes: "us",
      viewbox: `${minLng},${maxLat},${maxLng},${minLat}`,
      bounded: "1",
    });
    const res = await this.nominatimHttp.getJson<NominatimResponse>(`${this.cfg.nominatim.url}?${params}`);
    const m = res.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon) })).find((p) => this.inBounds(p.lng, p.lat));
    return m ? { ...m, method: "nominatim", matched: query } : null;
  }

  /** Runs one lookup; a failing service is logged and skipped so the next step can try. */
  private async tryStep(name: string, fn: () => Promise<GeocodeResult | null>): Promise<GeocodeResult | null> {
    try {
      return await fn();
    } catch (err) {
      const why = err instanceof RobotsDisallowedError ? "blocked by robots.txt" : (err as Error).message;
      this.warnings.push(`${name}: ${why}`);
      return null;
    }
  }

  private inBounds(lng: number, lat: number): boolean {
    const [minLng, minLat, maxLng, maxLat] = this.cfg.bounds;
    return Number.isFinite(lng) && Number.isFinite(lat) && lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
  }
}

/** Wake County PINs are 10 digits; agendas sometimes print them with spaces or dashes. */
export function normalizePin(pin: string): string | null {
  const digits = pin.replace(/[\s-]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * Turns an agenda address into one geocodable query, or null when it has no usable house
 * number. Lists like "5441, 0, 5301, & 5255 Wade Nash Road" use the first non-zero number;
 * "0" addresses (vacant land) alone can't be geocoded and rely on PINs instead.
 */
export function addressQuery(address: string, municipality: string): string | null {
  const cleaned = address.replace(/\ba portion of\b/gi, "").replace(/\s+/g, " ").trim();
  const m = /^((?:\d+[A-Za-z]?(?=[\s,&-])(?:\s|,|&|-|\band\b)*)+)(?<=\s)([A-Za-z0-9].*)$/.exec(cleaned);
  if (!m) return null;
  const number = m[1]!.match(/\d+[A-Za-z]?/g)?.find((n) => parseInt(n, 10) > 0);
  if (!number) return null;
  const city = /county/i.test(municipality) ? "" : `, ${municipality}`;
  return `${number} ${m[2]!.trim()}${city}, NC`;
}

/** Area-weighted centroid of an ArcGIS polygon ([lng, lat] rings; holes subtract by winding). */
export function ringsCentroid(rings: number[][][]): [number, number] | null {
  const origin = rings[0]?.[0];
  if (!origin) return null;
  // Work relative to the first vertex: raw lng/lat products lose precision to cancellation.
  const [ox, oy] = [origin[0]!, origin[1]!];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = [ring[i]![0]! - ox, ring[i]![1]! - oy];
      const [x1, y1] = [ring[i + 1]![0]! - ox, ring[i + 1]![1]! - oy];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
  }
  if (Math.abs(area) < 1e-18) {
    const pts = rings.flat();
    return [pts.reduce((s, p) => s + p[0]!, 0) / pts.length, pts.reduce((s, p) => s + p[1]!, 0) / pts.length];
  }
  return [ox + cx / (3 * area), oy + cy / (3 * area)];
}
