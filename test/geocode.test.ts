import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Geocoder, addressQuery, loadGeocodeConfig, normalizePin, ringsCentroid } from "../src/geo/geocode.js";
import { PoliteFetcher } from "../src/http/politeFetch.js";

// Responses below are hand-written in each service's documented shape (ArcGIS REST query,
// Census onelineaddress, Nominatim jsonv2), not saved from live calls: the dev environment's
// network policy blocks these hosts. Replace with saved responses once they can be fetched.

const cfg = loadGeocodeConfig();

async function geocoderWith(handler: (url: URL) => unknown) {
  const urls: URL[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const u = new URL(String(input));
    if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
    urls.push(u);
    const body = handler(u);
    return body === undefined ? new Response("boom", { status: 500 }) : Response.json(body);
  }) as typeof fetch;
  const http = new PoliteFetcher({ cacheDir: await mkdtemp(join(tmpdir(), "cr-")), minIntervalMs: 0, fetchImpl });
  return { geocoder: new Geocoder(cfg, { http, nominatimHttp: http }), urls };
}

const square = (lng: number, lat: number, d = 0.001) => [
  [
    [lng, lat],
    [lng, lat + d],
    [lng + d, lat + d],
    [lng + d, lat],
    [lng, lat],
  ],
];

describe("addressQuery", () => {
  it("uses the first non-zero house number of a list", () => {
    expect(addressQuery("5441, 0, 5301, & 5255 Wade Nash Road", "Fuquay-Varina")).toBe(
      "5441 Wade Nash Road, Fuquay-Varina, NC",
    );
    expect(addressQuery("0, 6921, & a portion of 6823 Sunset Lake Road", "Fuquay-Varina")).toBe(
      "6921 Sunset Lake Road, Fuquay-Varina, NC",
    );
    expect(addressQuery("602 & 606 S Main Street", "Fuquay-Varina")).toBe("602 S Main Street, Fuquay-Varina, NC");
  });

  it("keeps numbered street names and omits the city for county bodies", () => {
    expect(addressQuery("100 1st Street", "Wake County")).toBe("100 1st Street, NC");
  });

  it("returns null without a usable house number", () => {
    expect(addressQuery("0 Sunset Lake Road", "Fuquay-Varina")).toBeNull();
    expect(addressQuery("Bramer Drive", "Wake County")).toBeNull();
  });
});

describe("normalizePin / ringsCentroid", () => {
  it("accepts 10-digit PINs with separators", () => {
    expect(normalizePin("0647 99 2082")).toBe("0647992082");
    expect(normalizePin("12345")).toBeNull();
  });

  it("finds a polygon's centroid regardless of winding", () => {
    const [x, y] = ringsCentroid(square(-78.8, 35.6, 0.002))!;
    expect(x).toBeCloseTo(-78.799, 6);
    expect(y).toBeCloseTo(35.601, 6);
  });
});

describe("Geocoder", () => {
  it("prefers parcel PINs, averaging several parcel centroids", async () => {
    const { geocoder, urls } = await geocoderWith(() => ({
      features: [
        { attributes: { PIN_NUM: "0666173158" }, geometry: { rings: square(-78.8, 35.58) } },
        { attributes: { PIN_NUM: "0666174128" }, geometry: { rings: square(-78.798, 35.58) } },
      ],
    }));
    const r = await geocoder.geocode({
      municipality: "Fuquay-Varina",
      addresses: ["417 & 419 Raleigh Street"],
      parcel_pins: ["0666173158", "0666174128"],
    });
    expect(r).toMatchObject({ method: "pin", matched: "0666173158,0666174128" });
    expect(r!.lng).toBeCloseTo(-78.7985, 6);
    expect(urls).toHaveLength(1);
    expect(urls[0]!.searchParams.get("where")).toBe("PIN_NUM IN ('0666173158','0666174128')");
  });

  it("falls back to the Census geocoder, then Nominatim, skipping failures and out-of-county hits", async () => {
    const { geocoder, urls } = await geocoderWith((u) => {
      if (u.host === "maps.wakegov.com") return undefined; // parcel service down
      if (u.host === "geocoding.geo.census.gov")
        return { result: { addressMatches: [{ matchedAddress: "X", coordinates: { x: -80.8, y: 35.2 } }] } }; // Charlotte
      return [{ lat: "35.59", lon: "-78.77", display_name: "Sunset Lake Road" }];
    });
    const r = await geocoder.geocode({
      municipality: "Fuquay-Varina",
      addresses: ["7151 Sunset Lake Road"],
      parcel_pins: ["0667545940"],
    });
    expect(r).toEqual({ lat: 35.59, lng: -78.77, method: "nominatim", matched: "7151 Sunset Lake Road, Fuquay-Varina, NC" });
    expect(urls.map((u) => u.host)).toEqual(["maps.wakegov.com", "geocoding.geo.census.gov", "nominatim.openstreetmap.org"]);
    expect(geocoder.warnings[0]).toMatch(/^parcels: /);
  });

  it("returns null when nothing matches", async () => {
    const { geocoder } = await geocoderWith((u) =>
      u.host === "geocoding.geo.census.gov" ? { result: { addressMatches: [] } } : [],
    );
    expect(await geocoder.geocode({ municipality: "Wake County", addresses: ["3211 Bramer Drive"], parcel_pins: [] })).toBeNull();
  });
});
