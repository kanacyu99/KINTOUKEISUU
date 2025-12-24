import { useMemo, useState } from "react";
import Papa from "papaparse";
import type { LegendPayload } from "recharts";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// -------------------- Types --------------------
type SieveDataRow = {
  sieveSize: number;
  [key: string]: number | string;
};

type ResultRow = {
  caseName: string;
  D10: number | string;
  D30: number | string;
  D60: number | string;
  Cu: number | string;
  Cc: number | string;
};

type ValidationMessage = {
  rowIndex: number;
  caseName: string;
  message: string;
  type: "error" | "warning";
};

// -------------------- Tooltip (log axis label -> mm) --------------------
interface CustomTooltipPayload {
  dataKey?: string;
  value?: number;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayload[];
  label?: number | string; // label is x-value (log10)
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  const x = typeof label === "number" ? label : Number(label);
  if (Number.isNaN(x)) return null;

  const originalSieveSize = Math.pow(10, x);

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #ddd",
        padding: "8px 10px",
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      <div style={{ marginBottom: 6, fontWeight: 700 }}>
        粒径: {originalSieveSize.toFixed(3)} mm
      </div>
      {payload.map((p) => {
        if (!p?.dataKey) return null;
        if (p.value === null || p.value === undefined) return null;
        return (
          <div key={String(p.dataKey)} style={{ color: p.color ?? "#333" }}>
            {String(p.dataKey)}: {Number(p.value).toFixed(2)}%
          </div>
        );
      })}
    </div>
  );
};

// -------------------- Initial data --------------------
const initialSieveSizes: number[] = [53, 37.5, 31.5, 26.5, 19, 13.2, 4.75, 2.36, 0.425, 0.075];
const initialCases: string[] = Array.from({ length: 12 }, (_, i) => `Case ${i + 1}`);

const initialSieveData: SieveDataRow[] = initialSieveSizes.map((size) => ({
  sieveSize: size,
  ...initialCases.reduce((acc, c) => ({ ...acc, [c]: "" }), {} as Record<string, string>),
}));

const chartColors = [
  "#e6194B", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff",
  "#9A6324", "#fffac8", "#800000", "#aaffc3", "#808080", "#ffd8b1",
  "#000075", "#a9a9a9",
];

// -------------------- Helpers --------------------
function formatLogTick(tick: number) {
  // tick is log10(mm)
  const mm = Math.pow(10, tick);
  // "いい感じ"の表示（53, 37.5, 31.5… を崩さない）
  if (mm >= 10) return mm.toFixed(0);
  if (mm >= 1) return mm.toFixed(2);
  if (mm >= 0.1) return mm.toFixed(3);
  return mm.toFixed(3);
}

function toNumberOrNull(v: string): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return n;
}

// D値（対数補間）
function getDValue(points: { sieveSize: number; passing: number }[], target: number): number | string {
  const valid = points
    .filter((p) => p.sieveSize > 0 && !Number.isNaN(p.passing))
    .slice();

  if (valid.length < 2) return "データ不足";

  // passing で昇順（補間しやすい）
  valid.sort((a, b) => a.passing - b.passing);

  const minP = valid[0].passing;
  const maxP = valid[valid.length - 1].passing;
  if (target < minP || target > maxP) return "範囲外";

  // target を挟む2点を探す
  let p1: { sieveSize: number; passing: number } | null = null;
  let p2: { sieveSize: number; passing: number } | null = null;

  for (let i = 0; i < valid.length; i++) {
    if (valid[i].passing <= target) p1 = valid[i];
    if (valid[i].passing >= target && p2 === null) p2 = valid[i];
  }

  if (p1 && p1.passing === target) return p1.sieveSize;
  if (p2 && p2.passing === target) return p2.sieveSize;

  if (!p1 || !p2 || p1 === p2) return "計算不可";
  if (p1.sieveSize <= 0 || p2.sieveSize <= 0) return "計算不可";
  if (p2.passing === p1.passing) return p1.sieveSize;

  const logD1 = Math.log10(p1.sieveSize);
  const logD2 = Math.log10(p2.sieveSize);
  const logD = logD1 + ((logD2 - logD1) * (target - p1.passing)) / (p2.passing - p1.passing);

  return Math.pow(10, logD);
}

// -------------------- App --------------------
export default function App() {
  const [sieveData, setSieveData] = useState<SieveDataRow[]>(initialSieveData);
  const [cases, setCases] = useState<string[]>(initialCases);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);
  const [showCc, setShowCc] = useState<boolean>(true);

  const [visibleCases, setVisibleCases] = useState<Record<string, boolean>>(
    initialCases.reduce((acc, c) => ({ ...acc, [c]: true }), {} as Record<string, boolean>)
  );

  const [dLineCase, setDLineCase] = useState<string>(initialCases[0]);
  const [showDLines, setShowDLines] = useState<boolean>(true);

  const handleLegendClick = (e: LegendPayload) => {
    const key = e.dataKey;
    if (typeof key === "string") {
      setVisibleCases((prev) => ({ ...prev, [key]: !prev[key] }));
    }
  };

  const validateData = (data: SieveDataRow[]) => {
    const messages: ValidationMessage[] = [];
    const sorted = [...data].sort((a, b) => b.sieveSize - a.sieveSize);

    cases.forEach((caseName) => {
      let last: number | null = null;

      sorted.forEach((row) => {
        const idx = data.findIndex((d) => d.sieveSize === row.sieveSize);
        const value = toNumberOrNull(String(row[caseName] ?? ""));

        if (value === null) return;

        if (value < 0 || value > 100) {
          messages.push({ rowIndex: idx, caseName, message: "0-100の値を入力", type: "error" });
          return;
        }

        if (last !== null && value > last) {
          messages.push({ rowIndex: idx, caseName, message: "単調減少違反", type: "warning" });
        }

        last = value;
      });
    });

    setValidationMessages(messages);
    return !messages.some((m) => m.type === "error");
  };

  const handleInputChange = (rowIndex: number, caseName: string, value: string) => {
    const newData = [...sieveData];
    newData[rowIndex] = { ...newData[rowIndex], [caseName]: value };
    setSieveData(newData);
    validateData(newData);
  };

  const handleSieveSizeChange = (rowIndex: number, value: string) => {
    const newData = [...sieveData];
    const n = Number(value);
    newData[rowIndex] = { ...newData[rowIndex], sieveSize: Number.isNaN(n) ? 0 : n };
    newData.sort((a, b) => b.sieveSize - a.sieveSize);
    setSieveData(newData);
    validateData(newData);
  };

  const handleCalculate = () => {
    if (!validateData(sieveData)) {
      alert("入力エラーがあります。計算を実行する前に修正してください。");
      return;
    }

    const newResults: ResultRow[] = cases.map((caseName) => {
      const pts = sieveData
        .map((row) => {
          const passing = toNumberOrNull(String(row[caseName] ?? ""));
          return { sieveSize: row.sieveSize, passing };
        })
        .filter((p): p is { sieveSize: number; passing: number } => p.passing !== null && p.sieveSize > 0);

      if (pts.length < 2) {
        return { caseName, D10: "N/A", D30: "N/A", D60: "N/A", Cu: "N/A", Cc: "N/A" };
      }

      const D10 = getDValue(pts, 10);
      const D30 = getDValue(pts, 30);
      const D60 = getDValue(pts, 60);

      let Cu: number | string = "N/A";
      let Cc: number | string = "N/A";

      if (typeof D10 === "number" && typeof D60 === "number" && D10 > 0 && D60 > 0) {
        Cu = D60 / D10;
        if (typeof D30 === "number" && D30 > 0) {
          Cc = (D30 * D30) / (D10 * D60);
        }
      }

      return { caseName, D10, D30, D60, Cu, Cc };
    });

    setResults(newResults);
  };

  const handleAddCase = () => {
    const newCase = `Case ${cases.length + 1}`;
    setCases((prev) => [...prev, newCase]);
    setSieveData((prev) => prev.map((r) => ({ ...r, [newCase]: "" })));
    setVisibleCases((prev) => ({ ...prev, [newCase]: true }));
  };

  const handleRemoveCase = () => {
    if (cases.length <= 1) return;
    const last = cases[cases.length - 1];

    setCases((prev) => prev.slice(0, -1));

    setSieveData((prev) =>
      prev.map((row) => {
        const copy: SieveDataRow = { ...row };
        delete (copy as Record<string, unknown>)[last];
        return copy;
      })
    );

    setVisibleCases((prev) => {
      const copy = { ...prev };
      delete copy[last];
      return copy;
    });

    if (dLineCase === last) setDLineCase(cases[0]);
  };

  const handleDownloadCsv = () => {
    const csv1 = Papa.unparse({
      fields: ["Sieve Size (mm)", ...cases],
      data: sieveData.map((r) => {
        const row: Record<string, unknown> = { "Sieve Size (mm)": r.sieveSize };
        cases.forEach((c) => (row[c] = r[c]));
        return row;
      }),
    });

    const fields2 = ["Case", "D10", "D30", "D60", "Cu", ...(showCc ? ["Cc"] : [])];
    const csv2 = Papa.unparse({
      fields: fields2,
      data: results.map((r) => {
        const row: Record<string, unknown> = {
          Case: r.caseName,
          D10: r.D10,
          D30: r.D30,
          D60: r.D60,
          Cu: r.Cu,
        };
        if (showCc) row.Cc = r.Cc;
        return row;
      }),
    });

    const blob = new Blob([`\uFEFF${csv1}\n\n${csv2}`], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "sieve_analysis_data.csv";
    link.click();
  };

  const plottableCases = useMemo(() => {
    return cases.filter((caseName) => {
      const validPoints = sieveData.filter((row) => {
        const v = toNumberOrNull(String(row[caseName] ?? ""));
        return v !== null && row.sieveSize > 0;
      });
      return validPoints.length >= 2;
    });
  }, [cases, sieveData]);

  const chartData = useMemo(() => {
    const rows = sieveData
      .filter((r) => r.sieveSize > 0)
      .map((row) => {
        const out: { sieveSize: number; logSieveSize: number; [key: string]: number | null } = {
          sieveSize: row.sieveSize,
          logSieveSize: Math.log10(row.sieveSize),
        };

        cases.forEach((c) => {
          const n = toNumberOrNull(String(row[c] ?? ""));
          if (n === null) out[c] = null;
          else out[c] = Math.max(0, Math.min(100, n));
        });

        return out;
      });

    // 大→小 の順にして、線の並びを安定させる
    rows.sort((a, b) => b.sieveSize - a.sieveSize);
    return rows;
  }, [sieveData, cases]);

  const dLineValues = useMemo(() => {
    const r = results.find((x) => x.caseName === dLineCase);
    if (!r) return null;

    const toLog = (v: number | string) => (typeof v === "number" && v > 0 ? Math.log10(v) : null);

    return {
      D10: toLog(r.D10),
      D30: toLog(r.D30),
      D60: toLog(r.D60),
    };
  }, [results, dLineCase]);

  return (
    <div className="App">
      <h1>粒度試験分析 (Sieve Analysis)</h1>

      <div className="controls">
        <button onClick={handleCalculate}>計算実行</button>
        <button onClick={handleDownloadCsv}>CSVダウンロード</button>
        <button onClick={handleAddCase}>ケース列を追加</button>
        <button onClick={handleRemoveCase} disabled={cases.length <= 1}>
          ケース列を削除
        </button>

        <label style={{ marginLeft: 10 }}>
          <input type="checkbox" checked={showCc} onChange={() => setShowCc((p) => !p)} /> 曲率係数 (Cc) を表示
        </label>

        <label style={{ marginLeft: 10 }}>
          <input type="checkbox" checked={showDLines} onChange={() => setShowDLines((p) => !p)} /> D10/D30/D60 ライン
        </label>

        <label style={{ marginLeft: 10 }}>
          対象ケース：
          <select value={dLineCase} onChange={(e) => setDLineCase(e.target.value)} style={{ marginLeft: 6 }}>
            {cases.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h2>入力データ (通過百分率 %)</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>篩目 (mm)</th>
              {cases.map((caseName) => (
                <th key={caseName}>{caseName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sieveData.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td>
                  <input
                    type="number"
                    value={row.sieveSize}
                    onChange={(e) => handleSieveSizeChange(rowIndex, e.target.value)}
                    className="sieve-size-input"
                  />
                </td>
                {cases.map((caseName) => {
                  const msg = validationMessages.find((m) => m.rowIndex === rowIndex && m.caseName === caseName);
                  return (
                    <td key={caseName} className={msg ? `cell-${msg.type}` : ""} title={msg?.message}>
                      <input
                        type="number"
                        value={row[caseName]}
                        onChange={(e) => handleInputChange(rowIndex, caseName, e.target.value)}
                        min="0"
                        max="100"
                        step="any"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results.length > 0 && (
        <>
          <h2>計算結果</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>ケース</th>
                  <th>D10 (mm)</th>
                  <th>D30 (mm)</th>
                  <th>D60 (mm)</th>
                  <th>均等係数 (Cu)</th>
                  {showCc && <th>曲率係数 (Cc)</th>}
                </tr>
              </thead>
              <tbody>
                {results.map((res) => (
                  <tr key={res.caseName}>
                    <td>{res.caseName}</td>
                    <td>{typeof res.D10 === "number" ? res.D10.toFixed(3) : res.D10}</td>
                    <td>{typeof res.D30 === "number" ? res.D30.toFixed(3) : res.D30}</td>
                    <td>{typeof res.D60 === "number" ? res.D60.toFixed(3) : res.D60}</td>
                    <td>{typeof res.Cu === "number" ? res.Cu.toFixed(2) : res.Cu}</td>
                    {showCc && <td>{typeof res.Cc === "number" ? res.Cc.toFixed(2) : res.Cc}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>粒度曲線グラフ</h2>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={520}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />

            {/* X = log10(mm) numeric axis */}
            <XAxis
              dataKey="logSieveSize"
              type="number"
              domain={["dataMin", "dataMax"]}
              reversed
              tickFormatter={(tick) => formatLogTick(Number(tick))}
              label={{ value: "粒径 (mm) [対数スケール]", position: "insideBottom", offset: -10 }}
              allowDuplicatedCategory={false}
            />

            <YAxis
              domain={[0, 100]}
              ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
              label={{ value: "通過百分率 (%)", angle: -90, position: "insideLeft" }}
            />

            <Tooltip content={<CustomTooltip />} />
            <Legend onClick={handleLegendClick} />

            {/* D-lines (for selected case) */}
            {showDLines && dLineValues && (
              <>
                {dLineValues.D10 !== null && (
                  <ReferenceLine x={dLineValues.D10} stroke="#666" strokeDasharray="4 4" label="D10" />
                )}
                {dLineValues.D30 !== null && (
                  <ReferenceLine x={dLineValues.D30} stroke="#666" strokeDasharray="4 4" label="D30" />
                )}
                {dLineValues.D60 !== null && (
                  <ReferenceLine x={dLineValues.D60} stroke="#666" strokeDasharray="4 4" label="D60" />
                )}
              </>
            )}

            {plottableCases.map((caseName) => {
              const idx = cases.findIndex((c) => c === caseName);
              return (
                <Line
                  key={caseName}
                  type="monotone"
                  dataKey={caseName}
                  stroke={chartColors[idx % chartColors.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  hide={!visibleCases[caseName]}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
