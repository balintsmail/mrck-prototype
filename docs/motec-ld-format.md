# MoTeC .ld / .ldx files

The MoTeC i2 logger format, as decoded by `js/motec-ld.js` (browser) and `tools/motec/LdReader.cs` (Windows / PowerShell).
MoTeC does not publish the format. The layout below follows the community `ldparser` project and has been checked against real files.

## Validation

Reference session: Paul Ricard, 2026-09-17, "D2 Q1.3", C125 dash, 286 channels, 570 s
(`C:\MoTeC\Logged Data\EWC\2026\2026-09-15_BoldOr_Race\20260917-210720040.ld`).

- All 286 channels were decoded and compared with i2's CSV export of the same file (500 Hz, 287 columns).
  285 columns matched a channel, and about 5.5 million values showed 0 mismatches beyond the CSV's rounding.
  Values were compared only on rows that fall exactly on each channel's own samples, because i2 interpolates the
  lower-rate channels when it resamples to 500 Hz.
- `Time` and `Distance` are calculated by i2 and are not stored in the `.ld`.

## File header (little endian)

| Offset | Type | Content |
|---|---|---|
| 0x00 | u32 | marker, always `0x40` |
| 0x08 | u32 | pointer to the first channel header |
| 0x0C | u32 | pointer to the channel data |
| 0x24 | u32 | pointer to the event block |
| 0x4A | char[8] | device type, e.g. `C125` |
| 0x56 | u16 | number of channels |
| 0x5E | char[16] | date `dd/mm/yyyy` |
| 0x7E | char[16] | time `hh:mm:ss` |
| 0x15E | char[64] | venue |

The event block contains the event name (char[64]) followed by the session (char[64]).

## Channel headers: a linked list, 124 bytes each

| Offset | Type | Content |
|---|---|---|
| 0 | u32 | previous header (0 = first) |
| 4 | u32 | next header (0 = last) |
| 8 | u32 | pointer to this channel's data |
| 12 | u32 | number of samples |
| 16 | u16 | counter |
| 18 | u16 | data type A: 0 / 3 / 5 = integer, 7 = float |
| 20 | u16 | bytes per sample: 2 or 4 (a 2-byte float is IEEE half precision) |
| 22 | u16 | sample rate [Hz] |
| 24 | i16 | shift |
| 26 | i16 | mul |
| 28 | i16 | scale |
| 30 | i16 | decimal places |
| 32 | char[32] | name |
| 64 | char[8] | short name |
| 72 | char[12] | unit |

Each value is converted to engineering units as `(raw / scale × 10^-dec + shift) × mul`.
A channel's duration is `samples / rate`, and every channel starts at t = 0.

## Laps

- The `.ld` contains a `Beacon` channel (1 Hz) whose values are packed beacon messages. Its encoding has not been decoded yet.
- Exact lap markers come from the reset of `Running Lap Time` (10 Hz): marker = sample time − running lap time at
  the first sample after the reset. This reproduces i2's markers to within 1 ms (193.169 / 306.799 / 420.369 s).
- `Lap Time` gives each completed lap's time, rounded to 0.01 s.

## .ldx (sidecar XML)

Session details that are not in the `.ld` header: Event, Venue, Driver, Team, Vehicle Id / Number, Session, Log Date / Time,
Fuel Tank Capacity, Total Laps, Fastest Time, Fastest Lap. It is plain XML (`LDXFile/Layers/Details/*` with `Id` / `Value` attributes).

## Channels used by the prototype

| Channel | Unit | Rate | Use |
|---|---|---|---|
| `phi_lean` | deg | 100 Hz | lean angle; folded to \|lean\| so left and right share the slip-target lean axis; corner detection |
| `slip` | % | 100 Hz | rear slip; samples below 0 % are dropped |
| `mu_x_rear` | – | 100 Hz | μ filter |
| `Gear` | – | 20 Hz | gear filter (0 = neutral, never shown) |
| `slip_tgt` | % | 100 Hz | ECU slip target, dotted white line; 102.35 = inactive (values above 25.5 % are dropped) |
| `md_req`, `md_tgt_dtc` | Nm | 100 Hz | DTC torque reduction = max(0, md_req − md_tgt_dtc), used when `md_dtc_reduction` is not logged |
| `v_ref` | km/h | 100 Hz | timeline trace |
| `Running Lap Time` | s | 10 Hz | laps |
| `s_track` | m | 10 Hz | matches corners between laps by distance |

The DTC torque reduction formula was checked on the reference log: md_tgt_dtc follows md_req (within about 1 Nm; 0 when md_req is negative) except while
slip is above slip_tgt, e.g. at 350.0 s: slip 10.35 % > target 7.7 %, md_req 107.5 Nm, md_tgt_dtc 95.5 Nm, so 12 Nm is cut.
`idx_sec_dec` / `idx_sec_acc` / `ST_sectoring` (ECU track sectors) were constant in that log (sectoring off).

## Tools (`tools/motec/`)

- `LdReader.cs`: C# reader. It also contains `Compare()` (checks the decoded values against an i2 CSV export),
  a resampler and the lap-marker detection.
- `build_lean_slip.ps1` + `lean_slip_template.html`: builds a standalone analysis page from any `.ld` / `.ldx`.
  The page has a lean vs slip scatter coloured by mu_x, a lap / section timeline, and gear and mu_x filters.

  `powershell -ExecutionPolicy Bypass -File tools/motec/build_lean_slip.ps1 -Ld "C:\MoTeC\Logged Data\...\file.ld"`
