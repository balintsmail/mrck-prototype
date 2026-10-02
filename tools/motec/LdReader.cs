using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

public class LdChannel {
    public string Name, ShortName, Unit;
    public int Freq, N, DtypeA, Dtype, Shift, Mul, Scale, Dec;
    public double[] Data;
}

public static class LdReader {
    static string Str(byte[] b, int off, int len) {
        int end = off; while (end < off + len && b[end] != 0) end++;
        return Encoding.ASCII.GetString(b, off, end - off).Trim();
    }

    public static List<LdChannel> Read(string path, out string info) {
        byte[] b = File.ReadAllBytes(path);
        uint metaPtr = BitConverter.ToUInt32(b, 8);
        int nChan = BitConverter.ToUInt16(b, 0x56);
        info = string.Format("date={0} time={1} venue={2} device={3} nChanHeader={4}",
            Str(b, 0x5E, 16), Str(b, 0x7E, 16), Str(b, 0x15E, 64), Str(b, 0x4A, 8), nChan);
        var list = new List<LdChannel>();
        uint p = metaPtr;
        while (p != 0) {
            var c = new LdChannel();
            uint next = BitConverter.ToUInt32(b, (int)p + 4);
            uint dptr = BitConverter.ToUInt32(b, (int)p + 8);
            c.N = (int)BitConverter.ToUInt32(b, (int)p + 12);
            c.DtypeA = BitConverter.ToUInt16(b, (int)p + 18);
            c.Dtype = BitConverter.ToUInt16(b, (int)p + 20);
            c.Freq = BitConverter.ToUInt16(b, (int)p + 22);
            c.Shift = BitConverter.ToInt16(b, (int)p + 24);
            c.Mul = BitConverter.ToInt16(b, (int)p + 26);
            c.Scale = BitConverter.ToInt16(b, (int)p + 28);
            c.Dec = BitConverter.ToInt16(b, (int)p + 30);
            c.Name = Str(b, (int)p + 32, 32);
            c.ShortName = Str(b, (int)p + 64, 8);
            c.Unit = Str(b, (int)p + 72, 12);
            c.Data = new double[c.N];
            bool isFloat = c.DtypeA == 7;
            double k = Math.Pow(10, -c.Dec) / c.Scale;
            for (int i = 0; i < c.N; i++) {
                double raw;
                if (isFloat && c.Dtype == 4) raw = BitConverter.ToSingle(b, (int)dptr + 4 * i);
                else if (isFloat && c.Dtype == 2) raw = HalfToFloat(BitConverter.ToUInt16(b, (int)dptr + 2 * i));
                else if (c.Dtype == 4) raw = BitConverter.ToInt32(b, (int)dptr + 4 * i);
                else if (c.Dtype == 2) raw = BitConverter.ToInt16(b, (int)dptr + 2 * i);
                else throw new Exception("unknown dtype " + c.DtypeA + "/" + c.Dtype + " in " + c.Name);
                c.Data[i] = (raw * k + c.Shift) * c.Mul;
            }
            list.Add(c);
            p = next;
        }
        return list;
    }

    static float HalfToFloat(ushort h) {
        int s = (h >> 15) & 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
        double v = e == 0 ? m * Math.Pow(2, -24) : e == 31 ? double.NaN : (1 + m / 1024.0) * Math.Pow(2, e - 15);
        return (float)(s == 1 ? -v : v);
    }

    // Compare against MoTeC CSV export: only at rows that land exactly on a channel sample.
    public static string Compare(List<LdChannel> chans, string csvPath, double csvRate) {
        var sb = new StringBuilder();
        using (var r = new StreamReader(csvPath)) {
            string line; int ln = 0; string[] hdr = null;
            while ((line = r.ReadLine()) != null) { ln++; if (line.StartsWith("\"Time\"")) { hdr = Split(line); break; } }
            r.ReadLine(); r.ReadLine(); r.ReadLine(); // units + 2 blanks
            var map = new Dictionary<int, LdChannel>();
            var byName = chans.GroupBy(c => c.Name).ToDictionary(g => g.Key, g => g.First());
            var missing = new List<string>();
            for (int i = 0; i < hdr.Length; i++) { LdChannel c; if (byName.TryGetValue(hdr[i], out c)) map[i] = c; else missing.Add(hdr[i]); }
            var checks = new Dictionary<int, int>(); var fails = new Dictionary<int, int>(); var maxErr = new Dictionary<int, double>();
            foreach (var k in map.Keys) { checks[k] = 0; fails[k] = 0; maxErr[k] = 0; }
            int row = 0;
            while ((line = r.ReadLine()) != null) {
                if (line.Length == 0) continue;
                string[] f = null;
                foreach (var kv in map) {
                    var c = kv.Value;
                    if (c.Freq == 0 || ((long)row * c.Freq) % (long)csvRate != 0) continue;
                    long idx = (long)row * c.Freq / (long)csvRate;
                    if (idx >= c.N) continue;
                    if (f == null) f = Split(line);
                    double v; if (kv.Key >= f.Length || !double.TryParse(f[kv.Key], NumberStyles.Float, CultureInfo.InvariantCulture, out v)) continue;
                    double ld = c.Data[idx];
                    double err = Math.Abs(v - ld);
                    double tol = 0.5 * Math.Pow(10, -Math.Max(c.Dec, 0)) * Math.Abs(c.Mul == 0 ? 1 : c.Mul) + 1e-6 + 1e-6 * Math.Abs(ld);
                    checks[kv.Key]++;
                    if (err > tol) { fails[kv.Key]++; }
                    if (err > maxErr[kv.Key]) maxErr[kv.Key] = err;
                }
                row++;
            }
            int okCh = 0, badCh = 0; long totalChecks = 0;
            foreach (var k in map.Keys) {
                totalChecks += checks[k];
                if (fails[k] == 0 && checks[k] > 0) okCh++;
                else { badCh++; sb.AppendLine(string.Format("  MISMATCH {0} [{1}] {2}Hz: {3}/{4} fails, maxErr={5}", hdr[k], map[k].Unit, map[k].Freq, fails[k], checks[k], maxErr[k])); }
            }
            sb.Insert(0, string.Format("CSV rows={0}, CSV cols={1}, matched to ld channels={2}, exact-match channels={3}, mismatched={4}, value checks={5}\nCSV cols not in .ld: {6}\n",
                row, hdr.Length, map.Count, okCh, badCh, totalChecks, string.Join(", ", missing)));
        }
        return sb.ToString();
    }

    // Sample-and-hold resample to a common rate.
    public static double[] Resample(LdChannel c, int rate, int n) {
        var r = new double[n];
        for (int i = 0; i < n; i++) {
            long k = (long)i * c.Freq / rate;
            r[i] = c.Data[Math.Min(k, c.N - 1)];
        }
        return r;
    }

    public static string Json(double[] d, int dec) {
        var sb = new StringBuilder(d.Length * 6);
        sb.Append('[');
        for (int i = 0; i < d.Length; i++) {
            if (i > 0) sb.Append(',');
            sb.Append(Math.Round(d[i], dec).ToString(CultureInfo.InvariantCulture));
        }
        return sb.Append(']').ToString();
    }

    // Beacon times recovered from the "Running Lap Time" channel: at the first sample
    // after a reset, marker = sample time - running lap time.
    public static double[] LapMarkers(LdChannel rlt) {
        var m = new List<double>();
        for (int i = 1; i < rlt.N; i++) {
            double prev = rlt.Data[i - 1], cur = rlt.Data[i];
            if (cur < prev - 0.5 || (prev == 0 && cur > 0)) {
                double t = (double)i / rlt.Freq - cur;
                if (t > 1.0) m.Add(Math.Round(t, 3));
            }
        }
        return m.ToArray();
    }

    static string[] Split(string line) {
        return line.Split(',').Select(s => s.Trim('"')).ToArray();
    }
}

