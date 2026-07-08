#!/usr/bin/env python3
"""build_stars.py — enrich data/stars.json with spectral type + distance.

The StarMap catalog (data/stars.json) ships with only position, magnitude and
names (r, d, m, n, b). To let the "tap to identify" feature describe a star's
type / lifespan / makeup we need its spectral class and distance. Rather than
regenerate the tuned catalog from scratch (which would risk changing the star
set and the Bayer-letter formatting), this script MERGES those two fields into
the existing entries by matching each star to the nearest HYG-database row.

Adds per star (when a confident match is found):
  sp  spectral class string, e.g. "A0V"
  ly  distance in light-years (rounded)

Usage:
  python3 tools/build_stars.py                 # download HYG, enrich in place
  HYG_CSV=/path/to/hygdata_v41.csv python3 tools/build_stars.py   # local CSV

If HYG can't be reached, a small built-in table still tags the most famous
named stars, so the identify feature degrades gracefully offline.
"""
import csv
import io
import json
import math
import os
import sys
import urllib.request

HYG_URL = ("https://raw.githubusercontent.com/astronexus/HYG-Database/"
           "main/hyg/CURRENT/hygdata_v41.csv")
PC_TO_LY = 3.261563
HERE = os.path.dirname(os.path.abspath(__file__))
STARS_JSON = os.path.normpath(os.path.join(HERE, "..", "data", "stars.json"))

# Positional-match tolerances.
MATCH_SEP_DEG = 0.05    # ~3 arcmin
MATCH_MAG_TOL = 0.5     # magnitudes

# Fallback spectral types for well-known stars, used only if HYG is unavailable.
FALLBACK_SPECT = {
    "Sirius": ("A1V", 8.6), "Canopus": ("A9II", 310.0), "Arcturus": ("K1.5III", 36.7),
    "Vega": ("A0V", 25.0), "Capella": ("G3III", 42.9), "Rigel": ("B8Ia", 860.0),
    "Procyon": ("F5IV-V", 11.5), "Betelgeuse": ("M1-2Ia-ab", 548.0),
    "Achernar": ("B6Vpe", 139.0), "Aldebaran": ("K5III", 65.3),
    "Antares": ("M1.5Iab", 550.0), "Spica": ("B1III-IV", 250.0),
    "Pollux": ("K0III", 33.8), "Fomalhaut": ("A3V", 25.1), "Deneb": ("A2Ia", 2615.0),
    "Regulus": ("B8IVn", 79.3), "Altair": ("A7V", 16.7), "Bellatrix": ("B2III", 250.0),
    "Polaris": ("F7Ib", 433.0), "Castor": ("A1V", 51.6), "Alnilam": ("B0Ia", 2000.0),
    "Mizar": ("A2V", 82.9), "Alcor": ("A5V", 81.7), "Algol": ("B8V", 90.0),
    "Alphard": ("K3II-III", 177.0), "Hamal": ("K2III", 65.8),
}


def download_hyg():
    src = os.environ.get("HYG_CSV")
    if src:
        print(f"reading local HYG CSV: {src}", file=sys.stderr)
        with open(src, "r", encoding="utf-8") as f:
            return f.read()
    print(f"downloading HYG: {HYG_URL}", file=sys.stderr)
    with urllib.request.urlopen(HYG_URL, timeout=60) as r:
        return r.read().decode("utf-8")


def load_hyg_rows(text):
    """Return list of dicts: {ra_deg, dec, mag, spect, ly}."""
    rows = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        try:
            mag = float(row["mag"])
        except (KeyError, ValueError):
            continue
        spect = (row.get("spect") or "").strip()
        try:
            dist_pc = float(row["dist"])
        except (KeyError, ValueError):
            dist_pc = 0.0
        if not spect and dist_pc <= 0:
            continue
        try:
            ra_deg = float(row["ra"]) * 15.0   # HYG ra is in hours
            dec = float(row["dec"])
        except (KeyError, ValueError):
            continue
        ly = None
        # HYG uses 100000 pc as an "unknown / effectively infinite" placeholder.
        if 0 < dist_pc < 100000:
            ly = round(dist_pc * PC_TO_LY, 1)
        rows.append({"ra": ra_deg, "dec": dec, "mag": mag,
                     "spect": spect or None, "ly": ly})
    return rows


def bucketize(rows):
    """Bucket HYG rows by integer declination for fast neighbour lookup."""
    buckets = {}
    for r in rows:
        buckets.setdefault(int(round(r["dec"])), []).append(r)
    return buckets


def angsep_deg(ra1, dec1, ra2, dec2):
    """Angular separation (deg). Small-angle-safe haversine on the sphere."""
    d2r = math.pi / 180.0
    dra = (ra1 - ra2) * d2r
    dd = (dec1 - dec2) * d2r
    a = (math.sin(dd / 2) ** 2 +
         math.cos(dec1 * d2r) * math.cos(dec2 * d2r) * math.sin(dra / 2) ** 2)
    return 2 * math.asin(min(1.0, math.sqrt(a))) / d2r


def best_match(star, buckets):
    r0, d0, m0 = star["r"], star["d"], star["m"]
    best, best_sep = None, MATCH_SEP_DEG
    for db in (int(round(d0)) - 1, int(round(d0)), int(round(d0)) + 1):
        for cand in buckets.get(db, ()):  # noqa: E501
            if abs(cand["mag"] - m0) > MATCH_MAG_TOL:
                continue
            sep = angsep_deg(r0, d0, cand["ra"], cand["dec"])
            if sep < best_sep:
                best, best_sep = cand, sep
    return best


def main():
    with open(STARS_JSON, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    stars = catalog["stars"]

    try:
        text = download_hyg()
        hyg = load_hyg_rows(text)
        buckets = bucketize(hyg)
        print(f"loaded {len(hyg)} usable HYG rows", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — network/parse failure -> fallback
        print(f"HYG unavailable ({e}); using fallback table only", file=sys.stderr)
        buckets = None

    matched = 0
    for s in stars:
        s.pop("sp", None)
        s.pop("ly", None)
        m = best_match(s, buckets) if buckets else None
        if m:
            if m["spect"]:
                s["sp"] = m["spect"]
            if m["ly"] is not None:
                s["ly"] = m["ly"]
            if "sp" in s or "ly" in s:
                matched += 1
        elif s.get("n") in FALLBACK_SPECT:
            sp, ly = FALLBACK_SPECT[s["n"]]
            s["sp"], s["ly"] = sp, ly
            matched += 1

    with_sp = sum(1 for s in stars if s.get("sp"))
    with_ly = sum(1 for s in stars if s.get("ly") is not None)
    print(f"enriched {matched}/{len(stars)} stars "
          f"(spectral: {with_sp}, distance: {with_ly})", file=sys.stderr)

    # Compact JSON, matching the existing one-object-per-line-ish style.
    catalog["stars"] = stars
    with open(STARS_JSON, "w", encoding="utf-8") as f:
        json.dump(catalog, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    print(f"wrote {STARS_JSON}", file=sys.stderr)


if __name__ == "__main__":
    main()
