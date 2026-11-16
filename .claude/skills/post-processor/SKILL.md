---
name: post-processor
description: Adding a controller or changing a post config. Declarative versioned post configs interpreted by one generator. Spec §6.4, §7.1, §12.3.
---

# Post processor (spec §6.4)

The post is not code: it is a **versioned declarative config** plus one generator that interprets it. A new controller usually means only a new config file.

## Config defines
- program start/end, comment syntax `( )` or `;`, line numbers (on/off, increment)
- unit/mode lines (G21, G90, G17, G54 ...)
- tool change: auto (`T.. M6`), manual (pause + message) or none (one file per tool)
- spindle on/off, rpm, warm-up dwell (seconds or milliseconds syntax)
- rapid/linear format, decimal places
- arcs: I/J (incremental or absolute) or R; full-circle support; no arcs → split into lines
- drill cycle support (G81/G83) or explicit moves
- vacuum and machine-specific M codes
- file extension, file name length limit, line ending (CRLF/LF), file size limit and splitting

Validated with a Zod schema. Name and version, e.g. "Generic – NittCam v1.0". Each version has golden NC files in the repo.

## New controller checklist
- [ ] 2–3 real NC files from the machine in `docs/machines/<machine>/samples/`
- [ ] config written by comparing against those samples (header, arcs, tool change, end)
- [ ] golden files generated, owner approves (needs-human)
- [ ] reader passes all §7.2 checks
- [ ] air cut, then test cut, recorded in `docs/machines/<machine>/`
M1 starts with the "generic plain G-code" config. The controller brand is still unknown (spec §14.2).
