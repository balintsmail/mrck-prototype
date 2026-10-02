# MRCK Traction Control prototype

Interactive prototype of the BMW M 1000 RR *M Race Calibration* traction-control (DTC) editor:
slip-target maps with μ levels, riding-mode / gear allocation, settings and the +/- button user levels.

Plain HTML, CSS and JavaScript, no build step: open `index.html` or serve the folder with any static web server.

- `js/app.js`: app logic, tabs, tables, editor overlay
- `js/slip-chart.js`: the SVG slip-target graph
- `js/sheet-grid.js`: spreadsheet-style tables (copy / paste with Excel)
- `js/mu-lines.js`: μ level calculation (Degressive, Fix ratio, Custom values)
- `js/data.js`, `js/dataset.js`: data model and the imported calibration
- `tools/`: Perl scripts used to extract and prepare the dataset from `.bmwrc25` files
