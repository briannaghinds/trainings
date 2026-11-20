// The only place to edit settings. Contains no secrets: the Apps Script
// web-app URL is public by design (it is called from every visitor's browser).
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxb2TEV5oPGDjj4hptMuXzJ1zHNe98Qg2-rdWB0kCZWtNtjT4PhSVMFhreLcRBqhHP-/exec";
const SLIDE_COUNT = 8;
const MIN_REVIEW_SECONDS_AFTER_FAIL = 120;

// Convenience settings (not in the original spec, needed for the domain check
// and the first-time timer). Replace example.com with your company domain(s).
// An empty list [] means "check email format only".
// const ALLOWED_EMAIL_DOMAINS = ["example.com"];
const MIN_VIEW_SECONDS = 180;
