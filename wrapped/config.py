"""Central settings. Everything here can be overridden with environment variables (see .env.example)."""
import os
from pathlib import Path

# WRAPPED_HOME: run the whole pipeline in another person's folder (used by the upload server, one
# folder per person). Their data, caches and site all live there, and this project's .env (your own
# API key) is NOT loaded: they bring their own key in ANTHROPIC_API_KEY.
JOB_HOME = os.getenv("WRAPPED_HOME")
if not JOB_HOME:
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    except ImportError:
        pass

ROOT = Path(__file__).resolve().parent.parent
HOME = Path(JOB_HOME) if JOB_HOME else ROOT                        # where this person's data lives
RAW_DIR = Path(os.getenv("RAW_DIR", HOME / "data" / "raw"))      # put Streaming_History_Audio_*.json here
CACHE_DIR = HOME / "data" / "cache"
OUT_DIR = HOME / "data" / "out"
WEB_DIR = HOME / "web"
for d in (RAW_DIR, CACHE_DIR, OUT_DIR, WEB_DIR):
    d.mkdir(parents=True, exist_ok=True)

PLAYS_FILE = OUT_DIR / "plays.pkl"
TRACKS_FILE = OUT_DIR / "tracks.csv"
LYRICS_CACHE = CACHE_DIR / "lyrics.jsonl"
TAGS_CACHE = CACHE_DIR / "tags.jsonl"
ERAS_CACHE = CACHE_DIR / "eras.json"
SUMMARY_CACHE = CACHE_DIR / "summary.json"
DATA_JS = WEB_DIR / "data.js"
PHOTOS_DIR = WEB_DIR / "photos"          # one folder per era; drop pictures in and rerun build
ERA_NOTES = HOME / "era_notes.csv"       # where you lived + a caption per era (edit in Numbers/Excel)

# ---- Claude ----
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
TAG_MODEL = os.getenv("TAG_MODEL", "claude-haiku-4-5")        # cheap model for per-song tagging
WRITER_MODEL = os.getenv("WRITER_MODEL", "claude-sonnet-5-5")  # era names + final summary
TAG_CONCURRENCY = int(os.getenv("TAG_CONCURRENCY", "8"))
RESEARCH_MODEL = os.getenv("RESEARCH_MODEL", TAG_MODEL)        # tags songs without lyrics via web search
MAX_LYRIC_CHARS = int(os.getenv("MAX_LYRIC_CHARS", "3500"))

# ---- LRCLIB ----
LRCLIB_URL = "https://lrclib.net/api"
LRCLIB_USER_AGENT = os.getenv("LRCLIB_USER_AGENT", "forever-wrapped/1.0 (personal project)")
LRCLIB_PAUSE_SEC = float(os.getenv("LRCLIB_PAUSE_SEC", "0.3"))

# ---- Analysis thresholds ----
HOME_TZ = os.getenv("HOME_TZ", "America/New_York")
SESSION_GAP_MIN = 15          # gap that ends a listening session
MIN_DAY_MINUTES = 30          # days below this are excluded from mood extremes
MIN_PLAYS_SKIP_RATE = 8       # songs need this many plays to rank by skip rate
MIN_PLAYS_FALLEN = 20         # songs need this many plays to be a "fallen favorite"
SKIP_MS = 30_000              # a play under 30s counts as a skip
ERA_SPIKE_QUANTILE = 0.6      # bursts stronger than 60% of all bursts start an era (higher = fewer eras)

# ---- Tag taxonomy (one mood per song, two if music and lyrics clash, + picked themes) ----
MOODS = ["happy", "sad", "angry", "nostalgic", "romantic", "hyped", "calm", "anxious", "lonely", "hopeful"]
MOOD_COLORS = {   # saturated palette shared with the web app
    "happy": "#ffe500", "sad": "#2f6bff", "angry": "#ff2e2e", "nostalgic": "#ff9e3d",
    "romantic": "#ff4fa3", "hyped": "#c8ff00", "calm": "#00d1ff", "anxious": "#9d4dff",
    "lonely": "#8e9bb5", "hopeful": "#2bd96b",
}
THEMES = [
    "love", "heartbreak", "longing", "partying", "friendship", "family", "home", "ambition",
    "money", "self-doubt", "self-love", "independence", "nostalgia", "growing up", "freedom",
    "rebellion", "faith", "politics", "city life", "nature", "travel", "loss", "mental health",
    "sex", "dance", "storytelling", "escapism",
]

# conn_country -> time zone. Countries spanning several zones use their most common one.
# Add or change entries for places you've lived.
COUNTRY_TZ = {
    "US": HOME_TZ, "CA": "America/Toronto", "MX": "America/Mexico_City", "BR": "America/Sao_Paulo",
    "AR": "America/Argentina/Buenos_Aires", "CO": "America/Bogota", "CL": "America/Santiago",
    "PE": "America/Lima", "GB": "Europe/London", "IE": "Europe/Dublin", "FR": "Europe/Paris",
    "ES": "Europe/Madrid", "PT": "Europe/Lisbon", "IT": "Europe/Rome", "DE": "Europe/Berlin",
    "NL": "Europe/Amsterdam", "BE": "Europe/Brussels", "CH": "Europe/Zurich", "AT": "Europe/Vienna",
    "SE": "Europe/Stockholm", "NO": "Europe/Oslo", "DK": "Europe/Copenhagen", "FI": "Europe/Helsinki",
    "PL": "Europe/Warsaw", "CZ": "Europe/Prague", "GR": "Europe/Athens", "TR": "Europe/Istanbul",
    "IL": "Asia/Jerusalem", "AE": "Asia/Dubai", "SA": "Asia/Riyadh", "EG": "Africa/Cairo",
    "MA": "Africa/Casablanca", "ZA": "Africa/Johannesburg", "KE": "Africa/Nairobi", "NG": "Africa/Lagos",
    "IN": "Asia/Kolkata", "TH": "Asia/Bangkok", "VN": "Asia/Ho_Chi_Minh", "SG": "Asia/Singapore",
    "MY": "Asia/Kuala_Lumpur", "ID": "Asia/Jakarta", "PH": "Asia/Manila", "HK": "Asia/Hong_Kong",
    "TW": "Asia/Taipei", "CN": "Asia/Shanghai", "KR": "Asia/Seoul", "JP": "Asia/Tokyo",
    "AU": "Australia/Sydney", "NZ": "Pacific/Auckland",
}

# conn_country -> (display name, approx. center lat, lon) for the country-level map.
COUNTRY_INFO = {
    "US": ("United States", 39.8, -98.6), "CA": ("Canada", 56.1, -106.3), "MX": ("Mexico", 23.6, -102.5),
    "BR": ("Brazil", -14.2, -51.9), "AR": ("Argentina", -38.4, -63.6), "CO": ("Colombia", 4.6, -74.3),
    "CL": ("Chile", -35.7, -71.5), "PE": ("Peru", -9.2, -75.0), "GB": ("United Kingdom", 54.0, -2.5),
    "IE": ("Ireland", 53.4, -8.2), "FR": ("France", 46.6, 2.2), "ES": ("Spain", 40.4, -3.7),
    "PT": ("Portugal", 39.4, -8.2), "IT": ("Italy", 42.8, 12.6), "DE": ("Germany", 51.2, 10.4),
    "NL": ("Netherlands", 52.1, 5.3), "BE": ("Belgium", 50.5, 4.5), "CH": ("Switzerland", 46.8, 8.2),
    "AT": ("Austria", 47.5, 14.6), "SE": ("Sweden", 60.1, 18.6), "NO": ("Norway", 60.5, 8.5),
    "DK": ("Denmark", 56.3, 9.5), "FI": ("Finland", 61.9, 25.7), "PL": ("Poland", 51.9, 19.1),
    "CZ": ("Czechia", 49.8, 15.5), "GR": ("Greece", 39.1, 21.8), "TR": ("Turkey", 39.0, 35.2),
    "IL": ("Israel", 31.0, 34.9), "AE": ("UAE", 23.4, 53.8), "SA": ("Saudi Arabia", 23.9, 45.1),
    "EG": ("Egypt", 26.8, 30.8), "MA": ("Morocco", 31.8, -7.1), "ZA": ("South Africa", -30.6, 22.9),
    "KE": ("Kenya", -0.0, 37.9), "NG": ("Nigeria", 9.1, 8.7), "IN": ("India", 20.6, 78.9),
    "TH": ("Thailand", 15.9, 101.0), "VN": ("Vietnam", 14.1, 108.3), "SG": ("Singapore", 1.35, 103.8),
    "MY": ("Malaysia", 4.2, 101.9), "ID": ("Indonesia", -0.8, 113.9), "PH": ("Philippines", 12.9, 121.8),
    "HK": ("Hong Kong", 22.3, 114.2), "TW": ("Taiwan", 23.7, 121.0), "CN": ("China", 35.9, 104.2),
    "KR": ("South Korea", 35.9, 127.8), "JP": ("Japan", 36.2, 138.3), "AU": ("Australia", -25.3, 133.8),
    "NZ": ("New Zealand", -40.9, 174.9),
}

# Fill in every other country from the generated table (the hand-written entries above win).
from .countries import COUNTRY_INFO as _ALL_INFO, COUNTRY_TZ as _ALL_TZ
COUNTRY_INFO = {**_ALL_INFO, **COUNTRY_INFO}
COUNTRY_TZ = {**_ALL_TZ, **COUNTRY_TZ}

# Years with less listening than this are left out of year-vs-year comparisons
# (a year with a handful of plays would otherwise always look like a huge "change").
MIN_YEAR_MINUTES = 600
