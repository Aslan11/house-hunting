#!/usr/bin/env python3
"""Fill a card's display-only fields from its MetroListPRO detail page.

`mls-compose.py` writes every field the criteria are judged on — beds, full baths, price, acres,
pool, status — because those are what the gate needs and what the enumeration already read. It
leaves the fields that only affect how the card *looks* empty: photos, the agent's remarks, year
built, water, sewer, garage. On the spoofed route `scrape.js` filled those from the Coldwell Banker
IDX; on the no-spoof route nothing did, so a new card rendered with a blank photo tile and no
description while every older card had both.

That gap is cosmetic but it reads as a data problem, and on 2026-11-09 it was closed by hand. This
is that edit scripted, from the source the no-spoof route already uses:

    python3 mlp-enrich.py                 # every match with no photos
    python3 mlp-enrich.py 226119678 ...   # only these MLS numbers

MetroListPRO answers an ordinary request (README "The whole board can be built without claiming to
be a browser"), and its photos are on `mediarem.metrolist.net`, which hotlinks cleanly.

Three things it is careful about:

- **Scope.** The sheet is accepted only when the MLS number asked for appears in its <title>, the
  same gate `mlsl-verify.py` applies, because MetroListPRO serves an unknown id as a generic page
  with HTTP 200.
- **Document order.** The primary photo is the first in the markup, so photos are read in the order
  they appear and de-duplicated in place — never sorted, which would put an arbitrary interior shot
  on the card. `agentpics` are the listing agent's headshot, not the property, and are excluded.
- **Criteria fields are never touched.** This writes only the display keys below. Anything the gate
  judges stays exactly as the enumeration read it, so running this can't move a listing on or off
  the board.
"""
import json
import os
import re
import sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("mlsenum", os.path.join(HERE, "mls-enumerate.py"))
mlsenum = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mlsenum)

PHOTO_RE = re.compile(r'https://mediarem\.metrolist\.net/metrolist/listingpics/[^"\'\s>)]+')
DESC_RE = re.compile(r'<div class="[^"]*ihf-description[^"]*">(.*?)</div>', re.S)
MAX_PHOTOS = 6


def photos_of(html):
    """In document order — the first is the listing's primary photo."""
    out, seen = [], set()
    for u in PHOTO_RE.findall(html):
        if "agentpics" in u or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out[:MAX_PHOTOS]


def remarks_of(html):
    m = DESC_RE.search(html)
    if not m:
        return None
    text = re.sub(r"<[^>]+>", " ", m.group(1)).replace("&nbsp;", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def enrich(mls):
    url = f"https://www.metrolistpro.com/homes/2/6/x/{mls}"
    html = mlsenum.get(url)
    title, flat = mlsenum.text_of(html)
    if mls not in title:
        return None, f"scope gate: {mls} not in <title> ({title[:60]!r})"
    f = mlsenum.field_map(html)
    out = {"photos": photos_of(html), "summary": remarks_of(html)}
    year = mlsenum.field(flat, "Year Built", fields=f)
    if year and re.fullmatch(r"\d{4}", year.strip()):
        out["yearBuilt"] = int(year.strip())
    for key, label in (("water", "Water"), ("sewer", "Sewer"), ("view", "View"),
                       ("listedOn", "List Date")):
        val = mlsenum.field(flat, label, fields=f)
        if val and val.strip() not in ("", "-", "–", "N/A", "None"):
            out[key] = val.strip()
    garage = mlsenum.field(flat, "Garage Spaces", fields=f)
    try:
        out["garageSpaces"] = int(re.search(r"\d+", garage).group())
    except (TypeError, AttributeError, ValueError):
        pass
    return out, None


def main():
    wanted = [a for a in sys.argv[1:] if not a.startswith("-")]
    path = os.path.join(HERE, "listings.json")
    data = json.load(open(path))
    targets = [l for l in data["listings"]
               if (l["mls"] in wanted) if wanted] or \
              ([] if wanted else [l for l in data["listings"]
                                  if l.get("status") == "match" and not l.get("photos")])
    if not targets:
        print("nothing to enrich")
        return
    changed = 0
    for l in targets:
        fields, err = enrich(l["mls"])
        if err:
            print(f"  skip  {l['mls']} {l['address']}: {err}")
            continue
        # mlsSource is the board of record; MetroListPRO can only speak for MetroList.
        if (l.get("mlsSource") or "MetroList") != "MetroList":
            print(f"  skip  {l['mls']} {l['address']}: on {l['mlsSource']}, not MetroList")
            continue
        for k, v in fields.items():
            if v in (None, [], ""):
                continue
            l[k] = v
        changed += 1
        print(f"  filled {l['mls']} {l['address']}: "
              f"{len(fields.get('photos') or [])} photos, "
              f"{len(fields.get('summary') or '')} chars of remarks")
    if changed:
        json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
        open(path, "a").write("\n")
    print(f"{changed} card(s) enriched")


if __name__ == "__main__":
    main()
