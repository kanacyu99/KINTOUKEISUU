import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import type { LegendPayload } from 'recharts';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// -------------------- Types --------------------
type SieveRow = {
  sieveSize: number; // mm
  [caseName: string]: number | string;
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
  type: 'error' | 'warning';
};

// -------------------- Initial data --------------------
const initialSieveSizes: number[] = [53, 37.5, 31.5, 26.5, 19, 13.2, 4.75, 2.36, 0.425, 0.075];
const initialCases: string[] = Array.from({ length: 12 }, (_, i) => `Case ${i + 1}`);

const initialSieveData: SieveRow[] = initialSieveSizes.map((size) => ({
  sieveSize: size,
  ...initialCases.reduce((acc, c) => ({ ...acc, [c]: '' }), {}),
}));

const chartColors = [
  '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
  '#9A6324', '#fffac8', '#800000', '#aaffc3', '#808080', '#ffd8b1',
  '#000075', '#a9a9a9',
];

// -------------------- Tooltip --------------------
type CustomTooltipPayload = {
  dataKey?: string;
  value?: number;
  color?: string;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: CustomTooltipPayload[];
  label?: number; // sieveSize
};

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0 || typeof label !== 'number') return null;

  return (
    <div className="custom-tooltip" style={{ background: '#fff', border: '1px solid #ccc', padding: 10 }}>
      <p className="label">{`粒径: ${label} mm`}</p>
      {payload.map((pld) => {
        if (!pld.dataKey) return null;
        const v = pld.value;
        if (v === null || v === undefined || Number.isNaN(Number(v))) return null;
        return (
          <p key={pld.dataKey} style={{ color: pld.color }}>
            {`${pld.dataKey}: ${Number(v).toFixed(2)}%`}
          </p>
        );
      })}
    </div>
  );
};

function App() {
  const [sieveData, setSieveData] = useState<SieveRow[]>(initialSieveData);
  const [cases, setCases] = useState<string[]>(initialCases);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);
  const [showCc, setShowCc] = useState<boolean>(true);
  const [visibleCases, setVisibleCases] = useState<Record<string, boolean>>(
    initialCases.reduce((acc, c) => ({ ...acc, [c]: true }), {} as Record<string, boolean>)
  );

  // -------- Validation --------
  const validateData = (data: SieveRow[]) => {
    const messages: ValidationMessage[] = [];
    const sorted = [...data].filter(r => r.sieveSize > 0).sort((a, b) => b.sieveSize - a.sieveSize);

    cases.forEach((caseName) => {
      let last: number | null = null;
      sorted.forEach((row) => {
        const rowIndex = data.findIndex((d) => d.sieveSize === row.sieveSize);
        const valueStr = row[caseName] as string;

        if (!valueStr || valueStr.trim() === '') return;

        const v = parseFloat(valueStr);
        if (Number.isNaN(v) || v < 0 || v > 100) {
          messages.push({ rowIndex, caseName, message: '0-100の値を入力', type: 'error' });
          return;
        }

        if (last !== null && v > last) {
          messages.push({ rowIndex, caseName, message: '単調減少違反', type: 'warning' });
        }
        last = v;
      });
    });

    setValidationMessages(messages);
    return !messages.some((m) => m.type === 'error');
  };

  // -------- D-value (log-linear interpolation) --------
  const getDValue = (data: { passing: number; sieveSize: number }[], target: number): number | string => {
    const valid = [...data].filter(d => d.sieveSize > 0 && !Number.isNaN(d.passing));
    if (valid.length < 2) return 'データ不足';

    // sort by passing asc (0->100)
    const byPassing = [...valid].sort((a, b) => a.passing - b.passing);

    const minP = byPassing[0].passing;
    const maxP = byPassing[byPassing.length - 1].passing;
    if (target < minP || target > maxP) return '範囲外';

    let p1: { passing: number; sieveSize: number } | null = null;
    let p2: { passing: number; sieveSize: number } | null = null;

    for (let i = 0; i < byPassing.length; i++) {
      if (byPassing[i].passing <= target) p1 = byPassing[i];
      if (byPassing[i].passing >= target && p2 === null) p2 = byPassing[i];
    }

    if (!p1 || !p2) return '計算不可';
    if (p1.passing === target) return p1.sieveSize;
    if (p2.passing === target) return p2.sieveSize;
    if (p1 === p2) return '計算不可';
    if (p2.passing === p1.passing) return p1.sieveSize;

    const logD1 = Math.log10(p1.sieveSize);
    const logD2 = Math.log10(p2.sieveSize);
    const logD = logD1 + (logD2 - logD1) * (target - p1.passing) / (p2.passing - p1.passing);
    return Math.pow(10, logD);
  };

  // -------- Handlers --------
  const handleLegendClick = (e: LegendPayload) => {
    const key = e.dataKey;
    if (typeof key === 'string') {
      setVisibleCases((prev) => ({ ...prev, [key]: !prev[key] }));
    }
  };

  const handleInputChange = (rowIndex: number, caseName: string, value: string) => {
    const next = [...sieveData];
    next[rowIndex] = { ...next[rowIndex], [caseName]: value };
    setSieveData(next);
    validateData(next);
  };

  const handleSieveSizeChange = (rowIndex: number, value: string) => {
    const next = [...sieveData];
    const newSize = parseFloat(value);
    next[rowIndex] = { ...next[rowIndex], sieveSize: Number.isNaN(newSize) ? 0 : newSize };
    next.sort((a, b) => b.sieveSize - a.sieveSize);
    setSieveData(next);
    validateData(next);
  };

  const handleCalculate = () => {
    if (!validateData(sieveData)) {
      alert('入力エラーがあります。計算前に修正してください。');
      return;
    }

    const newResults: ResultRow[] = cases.map((caseName) => {
      const validData = sieveData
        .map((row) => ({
          sieveSize: row.sieveSize,
          passing: parseFloat(row[caseName] as string),
        }))
        .filter((d) => d.sieveSize > 0 && !Number.isNaN(d.passing));

      if (validData.length < 2) {
        return { caseName, D10: 'N/A', D30: 'N/A', D60: 'N/A', Cu: 'N/A', Cc: 'N/A' };
      }

      const D10 = getDValue(validData, 10);
      const D30 = getDValue(validData, 30);
      const D60 = getDValue(validData, 60);

      let Cu: number | string = 'N/A';
      let Cc: number | string = 'N/A';

      if (typeof D10 === 'number' && typeof D60 === 'number' && D10 > 0) {
        Cu = D60 / D10;
        if (typeof D30 === 'number') Cc = (D30 * D30) / (D10 * D60);
      }

      return { caseName, D10, D30, D60, Cu, Cc };
    });

    setResults(newResults);
  };

  const handleAddCase = () => {
    const newCaseName = `Case ${cases.length + 1}`;
    setCases((prev) => [...prev, newCaseName]);
    setSieveData((prev) => prev.map((row) => ({ ...row, [newCaseName]: '' })));
    setVisibleCases((prev) => ({ ...prev, [newCaseName]: true }));
  };

  const handleRemoveCase = () => {
    if (cases.length <= 1) return;
    const lastCaseName = cases[cases.length - 1];

    setCases((prev) => prev.slice(0, -1));
    setSieveData((prev) =>
      prev.map((row) => {
        const next = { ...row };
        delete next[lastCaseName];
        return next;
      })
    );
    setVisibleCases((prev) => {
      const next = { ...prev };
      delete next[lastCaseName];
      return next;
    });
  };

  const handleDownloadCsv = () => {
    const csv1 = Papa.unparse({
      fields: ['Sieve Size (mm)', ...cases],
      data: sieveData,
    });

    const csv2 = Papa.unparse({
      fields: ['Case', 'D10', 'D30', 'D60', 'Cu', ...(showCc ? ['Cc'] : [])],
      data: results.map((r) => {
        const row: any = { Case: r.caseName, D10: r.D10, D30: r.D30, D60: r.D60, Cu: r.Cu };
        return showCc ? { ...row, Cc: r.Cc } : row;
      }),
    });

    const csvData = `${csv1}\n\n${csv2}`;
    const blob = new Blob([`\uFEFF${csvData}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'sieve_analysis_data.csv';
    link.click();
  };

  // -------- Chart data --------
  const chartData = useMemo(() => {
    const rows = sieveData
      .filter((r) => r.sieveSize > 0)
      .map((row) => {
        const out: { sieveSize: number; [key: string]: number | null } = { sieveSize: row.sieveSize };
        cases.forEach((caseName) => {
          const s = row[caseName] as string;
          const v = parseFloat(s);
          out[caseName] = s && s.trim() !== '' && !Number.isNaN(v) ? Math.max(0, Math.min(100, v)) : null;
        });
        return out;
      })
      .sort((a, b) => b.sieveSize - a.sieveSize);

    return rows;
  }, [sieveData, cases]);

  const plottableCases = useMemo(() => {
    return cases.filter((caseName) => {
      const valid = chartData.filter((r) => typeof r[caseName] === 'number');
      return valid.length >= 2;
    });
  }, [chartData, cases]);

  const xMin = useMemo(() => Math.min(...chartData.map((r) => r.sieveSize)), [chartData]);
  const xMax = useMemo(() => Math.max(...chartData.map((r) => r.sieveSize)), [chartData]);

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
        <label style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={showCc} onChange={() => setShowCc((v) => !v)} /> 曲率係数 (Cc) を表示
        </label>
      </div>

      <h2>入力データ (通過百分率 %)</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>篩目 (mm)</th>
              {cases.map((c) => (
                <th key={c}>{c}</th>
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
                    <td key={caseName} className={msg ? `cell-${msg.type}` : ''} title={msg?.message}>
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
                {results.map((r) => (
                  <tr key={r.caseName}>
                    <td>{r.caseName}</td>
                    <td>{typeof r.D10 === 'number' ? r.D10.toFixed(3) : r.D10}</td>
                    <td>{typeof r.D30 === 'number' ? r.D30.toFixed(3) : r.D30}</td>
                    <td>{typeof r.D60 === 'number' ? r.D60.toFixed(3) : r.D60}</td>
                    <td>{typeof r.Cu === 'number' ? r.Cu.toFixed(2) : r.Cu}</td>
                    {showCc && <td>{typeof r.Cc === 'number' ? r.Cc.toFixed(2) : r.Cc}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>粒度曲線グラフ</h2>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={500}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />

            {/* ✅ Xは “実粒径(mm)” のまま + scale="log" が正解 */}
            <XAxis
              dataKey="sieveSize"
              type="number"
              scale="log"
              domain={[xMin, xMax]}
              reversed={true}
              ticks={initialSieveSizes}   // 主要篩目をそのまま表示
              tickFormatter={(v) => String(v)}
              allowDataOverflow={true}
              label={{ value: '粒径 (mm) [対数スケール]', position: 'insideBottom', offset: -15 }}
            />

            <YAxis
              domain={[0, 100]}
              ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
              label={{ value: '通過百分率 (%)', angle: -90, position: 'insideLeft' }}
            />

            <Tooltip content={<CustomTooltip />} />
            <Legend onClick={handleLegendClick} />

            {plottableCases.map((caseName) => {
              const idx = cases.findIndex((c) => c === caseName);
              return (
                <Line
                  key={caseName}
                  type="monotone"
                  dataKey={caseName}
                  stroke={visibleCases[caseName] ? chartColors[idx % chartColors.length] : 'transparent'}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
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

export default App;
