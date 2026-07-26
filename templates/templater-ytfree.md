<%*
// Templater snippet: prompts for a YouTube URL and builds an ad-free video note.
// Install: copy into your Templater templates folder.
const url = await tp.system.prompt("YouTube URL");
if (!url) return;

const match = url.match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|\/shorts\/([\w-]{11})|\/embed\/([\w-]{11})|\/live\/([\w-]{11})/);
const id = match ? (match[1] || match[2] || match[3] || match[4] || match[5]) : (/^[\w-]{11}$/.test(url.trim()) ? url.trim() : null);
if (!id) { new Notice("Not a YouTube URL"); return; }
-%>
---
source: https://www.youtube.com/watch?v=<% id %>
clipped: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - video
---

```ytfree
<% id %>
```

## Notes
