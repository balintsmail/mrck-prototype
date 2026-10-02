# MRCK Traction Control prototype

Interactive prototype of the BMW M 1000 RR *M Race Calibration* traction-control (DTC) editor:
slip-target maps with μ levels, riding-mode / gear allocation, settings and the +/- button user levels.

Plain HTML, CSS and JavaScript, no build step: open `index.html` or serve the folder with any static web server.

- `js/app.js`: app logic, tabs, tables, editor overlay
- `js/slip-chart.js`: the SVG slip-target graph
- `js/sheet-grid.js`: spreadsheet-style tables (copy / paste with Excel)
- `js/mu-lines.js`: μ level calculation (Degressive, Fix ratio, Custom values)
- `js/data.js`, `js/dataset.js`: data model and the imported calibration
- `js/motec-ld.js`: reads MoTeC `.ld` logs in the browser for **Import MOTEC data** (format: `docs/motec-ld-format.md`)
- `js/log-panel.js`: the imported log's filters, timeline and DTC torque reduction graph below the slip-target graph
- `tools/`: Perl scripts used to extract and prepare the dataset from `.bmwrc25` files
- `tools/motec/`: MoTeC `.ld` reader (C#) and a standalone lean / slip / mu_x analysis page builder

## Import MOTEC data

Select a MoTeC `.ld` file: it is read in the browser and `slip` is drawn behind the slip targets over the lean angle.
Left and right lean angles are shown together (|lean|), as the slip targets apply to both sides; only slip ≥ 0 % is shown.
The ECU's own slip target (`slip_tgt`) is the dotted white line. While a map is selected, only that map is drawn, and a μ filter
limits its μ band (20 %) to the filtered range. `js/log-panel.js`: the show switch and the "Logged data filters" (gears, μ, laps / corners, timeline) sit in the
left column under the allocation table (on +- Buttons, which has no left column, above the panel); the reduction graph is below the graph:

- **Show logged data** switch (the × on the import button removes the log)
- **DTC torque reduction** [Nm] over the same lean axis: `md_dtc_reduction`, or `md_req − md_tgt_dtc` when that channel is not logged
- **Gears** 1–6 and **μ** (`mu_x_rear`, −0.25 … 1.6; the ends are open, the bar between them can be dragged; full range on import, when its auto switch is turned off, and on double-click).
  *Automatically adjust* follows the graph: the gears whose slip targets are selected (on by default) and the μ range of the
  selected μ level, half-way to its neighbours (off by default). Changing a filter by hand switches it off.
- **Timeline**: laps (from `Running Lap Time`), or drag a section / its ends; **Corners & straights** on a track map from GPS
  (fastest lap): corners detected from the lean angle (|lean| ≥ 15° reaching 30°, numbered in track order on the fastest lap,
  matched on the other laps by `s_track` distance), straight n from corner n to the next one; click them to filter (blue)

## Export MRCK

The **Export MRCK** button downloads an ECU calibration file (`.bmwrc25`): the base calibration in `base/`
with its traction-control maps and settings replaced by the ones edited in the prototype, CRCs recalculated
(`js/bmwrc25.js`). Slip target maps are padded to the ECU's 10 lean points above 70°, repeating the 70° values.
