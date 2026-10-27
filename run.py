"""
Forever, Wrapped: run the pipeline one step at a time, or all at once.

    python run.py sample                 # (practice) make fake Spotify data
    python run.py load                   # 1. read your Spotify JSON into a clean table
    python run.py lyrics                 # 2. fetch lyrics from LRCLIB          (run on your laptop)
    python run.py tag    --mode live     # 3. Claude tags each song (live | batch | mock)
    python run.py tag --research-missing # 3b. songs with no lyrics: Claude web-searches, then tags
    python run.py eras   --mode live     # 4. find eras, Claude names them    (live | mock)
    python run.py build                  # 5. compute every chart -> web/data.js
    python run.py photos [--ai]          # 6. (Mac) pick era photos from Photos + where you were, then build again
    python run.py all    --mode mock     # every step in order

Add --limit 50 to lyrics/tag to try just your 50 most-played songs first.
Everything is cached in data/cache, so any step can be stopped and rerun safely.
"""
import argparse
import time
from wrapped import step0_sample, step1_load, step2_lyrics, step3_tag, step3b_research, step4_eras, step5_build, step6_photos


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", choices=["sample", "load", "lyrics", "tag", "eras", "build", "photos", "all"])
    p.add_argument("--mode", default="live", choices=["live", "batch", "mock"])
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--research-missing", action="store_true",
                   help="with `tag`: research and tag only the songs that have no lyrics")
    p.add_argument("--redo", nargs="+", default=None, metavar="MOOD",
                   help="with `tag`: tag songs with these moods again, e.g. --redo hyped")
    p.add_argument("--ai", action="store_true", help="with `photos`: let Claude choose among the best candidates")
    a = p.parse_args()

    steps = {
        "sample": lambda: step0_sample.run(),
        "load": lambda: step1_load.run(),
        "lyrics": lambda: step2_lyrics.run(a.limit, "mock" if a.mode == "mock" else "live"),
        "tag": lambda: step3b_research.run(a.limit) if a.research_missing else step3_tag.run(a.mode, a.limit, a.redo),
        "eras": lambda: step4_eras.run("mock" if a.mode == "mock" else "live"),
        "build": lambda: step5_build.run(),
        "photos": lambda: step6_photos.run(a.ai),
    }
    order = ["load", "lyrics", "tag", "eras", "build"] if a.step == "all" else [a.step]
    for name in order:
        t0 = time.time()
        print(f"[{name}]")
        steps[name]()
        print(f"  ({time.time() - t0:.1f}s)\n")


if __name__ == "__main__":
    main()
