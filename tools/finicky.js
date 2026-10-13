// Finicky config: YouTube links from other Mac apps open in YT Free (GitHub #3).
//
// 1. Install Finicky (https://github.com/johnste/finicky, free) and make it the default browser
//    when it asks. It is a router, not a browser: every other link goes to `defaultBrowser`.
// 2. Copy this file to ~/.finicky.js and change `defaultBrowser` to the browser you use.
//
// Video links only. Channel and playlist pages, and anything else on youtube.com, still go to
// the browser — YT Free v1 opens videos.
const VIDEO = /^https?:\/\/((www|m|music)\.)?(youtube\.com\/(watch|shorts\/|live\/|embed\/)|youtu\.be\/)/;

export default {
  defaultBrowser: "Safari",
  handlers: [
    {
      match: (url) => VIDEO.test(url.href),
      url: (url) => "obsidian://ytfree?url=" + encodeURIComponent(url.href),
      browser: "Obsidian",
    },
  ],
};
