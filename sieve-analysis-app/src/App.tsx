import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import type { LegendPayload } from 'recharts';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

// Type definitions
type SieveData = {
  sieveSize: number;
  [key: string]: number | string;
};

type ResultData = {
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

// Workaround for Recharts typing issues
interface CustomTooltipPayload {
  name: string;
  value: number;
  dataKey?: string;
  color?: string;
  payload?: object;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayload[];
  label?: number | string;
}

// ====== Settings you asked for ======
const X_MIN_MM = 0.075;
const X_MAX_MM = 106;

// Excelみたいな目盛り感（必要なら増減OK）
const AXIS_SIEVE_TICKS_MM = [
  0.075, 0.15, 0.425, 0.6, 1.18, 2.36, 4.75, 9.5, 13.2, 16, 19, 26.5, 31.5, 37.5, 53, 63, 75, 106,
];

// Custom Tooltip Component
const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length && typeof label === 'number') {
    const originalSieveSize = Math.pow(10, label);
    return (
      <div className="custom-tooltip">
        <p className="label">{`粒径: ${originalSieveSize.toFixed(3)} mm`}</p>
        {payload.map((pld) => {
          if (pld.value !== null && pld.value !== undefined && pld.dataKey) {
            return (
              <p key={pld.dataKey} style={{ color: pld.color }}>
                {`${pld.dataKey}: ${Number(pld.value).toFixed(2)}%`}
              </p>
            );
          }
          return null;
        })}
      </div>
    );
  }
  return null;
};

// Initial data
const initialSieveSizes: number[] = [53, 37.5, 31.5, 26.5, 19, 13.2, 4.75, 2.36, 0.425, 0.075];
const initialCases: string[] = Array.from({ length: 12 }, (_, i) => `Case ${i + 1}`);

const initialSieveData: SieveData[] = initialSieveSizes.map((size) => ({
  sieveSize: size,
  ...initialCases.reduce((acc, caseName) => ({ ...acc, [caseName]: '' }), {}),
}));

const chartColors = [
  '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
  '#9A6324', '#fffac8', '#800000', '#aaffc3', '#808080', '#ffd8b1',
  '#000075', '#a9a9a9',
];

function App() {
  const [sieveData, setSieveData] = useState<SieveData[]>(initialSieveData);
  const [cases, setCases] = useState<string[]>(initialCases);
  const [results, setResults] = useState<ResultData[]>([]);
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);
  const [showCc, setShowCc] = useState<boolean>(true);

  const [visibleCases, setVisibleCases] = useState<Record<string, boolean>>(
    initialCases.reduce((acc, caseName) => ({ ...acc, [caseName]: true }), {})
  );

  // ★ D-lines 表示対象ケース（まずはCase 1）
  const [dLineCase, setDLineCase] = useState<string>(initialCases[0]);

  const handleLegendClick = (e: LegendPayload) => {
    const key = e.dataKey;
    if (typeof key === 'string') {
      setVisibleCases((prev) => ({ ...prev, [key]: !prev[key] }));
    }
  };

  const handleInputChange = (rowIndex: number, caseName: string, value: string) => {
    const newData = [...sieveData];
    newData[rowIndex] = { ...newData[rowIndex], [caseName]: value };
    setSieveData(newData);
    validateData(newData);
  };

  const handleSieveSizeChange = (rowIndex: number, value: string) => {
    const newData = [...sieveData];
    const newSize = parseFloat(value);
    newData[rowIndex].sieveSize = isNaN(newSize) ? 0 : newSize;
    newData.sort((a, b) => b.sieveSize - a.sieveSize);
    setSieveData(newData);
    validateData(newData);
  };

  const validateData = (data: SieveData[]) => {
    const messages: ValidationMessage[] = [];
    const sortedData = [...data].sort((a, b) => b.sieveSize - a.sieveSize);

    cases.forEach((caseName) => {
      let lastValue: number | null = null;
      sortedData.forEach((row) => {
        const originalRowIndex = data.findIndex((d) => d.sieveSize === row.sieveSize);
        const valueStr = row[caseName] as string;

        if (!valueStr || valueStr.trim() === '') return;

        const value = parseFloat(valueStr);
        if (isNaN(value) || value < 0 || value > 100) {
          messages.push({ rowIndex: originalRowIndex, caseName, message: '0-100の値を入力', type: 'error' });
        } else {
          if (lastValue !== null && value > lastValue) {
            messages.push({ rowIndex: originalRowIndex, caseName, message: '単調減少違反', type: 'warning' });
          }
          lastValue = value;
        }
      });
    });

    setValidationMessages(messages);
    return !messages.some((msg) => msg.type === 'error');
  };

  const getDValue = (
    data: { passing: number; sieveSize: number }[],
    targetPercentage: number
  ): number | string => {
    const sortedBySize = [...data].sort((a, b) => b.sieveSize - a.sieveSize);
    const sortedByPassing = [...sortedBySize].sort((a, b) => a.passing - b.passing);

    if (sortedByPassing.length < 2) return 'データ不足';

    const minPassing = sortedByPassing[0].passing;
    const maxPassing = sortedByPassing[sortedByPassing.length - 1].passing;
    if (targetPercentage < minPassing || targetPercentage > maxPassing) {
      return '範囲外';
    }

    let p1: { passing: number; sieveSize: number } | null = null;
    let p2: { passing: number; sieveSize: number } | null = null;

    for (let i = 0; i < sortedByPassing.length; i++) {
      if (sortedByPassing[i].passing <= targetPercentage) p1 = sortedByPassing[i];
      if (sortedByPassing[i].passing >= targetPercentage && p2 === null) p2 = sortedByPassing[i];
    }

    if (p1 && p1.passing === targetPercentage) return p1.sieveSize;
    if (p2 && p2.passing === targetPercentage) return p2.sieveSize;

    if (!p1 || !p2 || p1 === p2) return '計算不可';

    const logD1 = Math.log10(p1.sieveSize);
    const logD2 = Math.log10(p2.sieveSize);

    if (p2.passing === p1.passing) return p1.sieveSize;

    const logD = logD1 + ((logD2 - logD1) * (targetPercentage - p1.passing)) / (p2.passing - p1.passing);
    return Math.pow(10, logD);
  };

  const handleCalculate = () => {
    if (!validateData(sieveData)) {
      alert('入力エラーがあります。計算を実行する前に修正してください。');
      return;
    }

    const newResults: ResultData[] = cases.map((caseName) => {
      const validData = sieveData
        .map((row) => ({
          sieveSize: row.sieveSize,
          passing: parseFloat(row[caseName] as string),
        }))
        .filter((item) => !isNaN(item.passing) && item.sieveSize > 0);

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
        if (typeof D30 === 'number') {
          Cc = (D30 * D30) / (D10 * D60);
        }
      }

      return { caseName, D10, D30, D60, Cu, Cc };
    });

    setResults(newResults);
  };

  const handleAddCase = () => {
    const newCaseName = `Case ${cases.length + 1}`;
    setCases([...cases, newCaseName]);
    setSieveData(sieveData.map((row) => ({ ...row, [newCaseName]: '' })));
    setVisibleCases({ ...visibleCases, [newCaseName]: true });
  };

  const handleRemoveCase = () => {
    if (cases.length <= 1) return;
    const newCases = [...cases];
    const lastCaseName = newCases.pop()!;
    setCases(newCases);

    setSieveData(
      sieveData.map((row) => {
        const newRow = { ...row };
        delete newRow[lastCaseName];
        return newRow;
      })
    );

    const newVisibleCases = { ...visibleCases };
    delete newVisibleCases[lastCaseName];
    setVisibleCases(newVisibleCases);

    if (dLineCase === lastCaseName) setDLineCase(newCases[0] ?? 'Case 1');
  };

  const handleDownloadCsv = () => {
    const csvData =
      Papa.unparse({
        fields: ['Sieve Size (mm)', ...cases],
        data: sieveData,
      }) +
      '\n\n' +
      Papa.unparse({
        fields: ['Case', 'D10', 'D30', 'D60', 'Cu', ...(showCc ? ['Cc'] : [])],
        data: results.map((r) => {
          const row = { Case: r.caseName, D10: r.D10, D30: r.D30, D60: r.D60, Cu: r.Cu };
          return showCc ? { ...row, Cc: r.Cc } : row;
        }),
      });

    const blob = new Blob([`\uFEFF${csvData}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'sieve_analysis_data.csv';
    link.click();
  };

  const plottableCases = useMemo(() => {
    return cases.filter((caseName) => {
      const validPoints = sieveData.filter((row) => {
        const value = parseFloat(row[caseName] as string);
        return !isNaN(value) && row.sieveSize > 0;
      });
      return validPoints.length >= 2;
    });
  }, [sieveData, cases]);

  const chartData = useMemo(() => {
    const processedData = sieveData
      .map((row) => {
        const newRow: { sieveSize: number; logSieveSize: number; [key: string]: number | null } = {
          sieveSize: row.sieveSize,
          logSieveSize: row.sieveSize > 0 ? Math.log10(row.sieveSize) : -Infinity,
        };

        cases.forEach((caseName) => {
          const valueStr = row[caseName] as string;
          if (valueStr === null || valueStr.trim() === '' || isNaN(parseFloat(valueStr))) {
            newRow[caseName] = null;
          } else {
            const value = parseFloat(valueStr);
            newRow[caseName] = Math.max(0, Math.min(100, value));
          }
        });

        return newRow;
      })
      .filter((row) => row.sieveSize > 0);

    // xは「小→大」で右に行く（あなたの完成図と同じ）
    processedData.sort((a, b) => a.sieveSize - b.sieveSize);
    return processedData;
  }, [sieveData, cases]);

  // X軸（対数）固定：0.075～106
  const xDomain = useMemo<[number, number]>(() => {
    return [Math.log10(X_MIN_MM), Math.log10(X_MAX_MM)];
  }, []);

  const xTicks = useMemo(() => {
    return AXIS_SIEVE_TICKS_MM.map((mm) => Math.log10(mm));
  }, []);

  // D-lines 用（選択ケースの結果から取得）
  const dLineResult = useMemo(() => {
    return results.find((r) => r.caseName === dLineCase) ?? null;
  }, [results, dLineCase]);

  const dLines = useMemo(() => {
    if (!dLineResult) return [];

    const items: { label: string; mm: number }[] = [];

    const addIfNumber = (label: string, v: number | string) => {
      if (typeof v === 'number' && v > 0) items.push({ label, mm: v });
    };

    addIfNumber('D10', dLineResult.D10);
    addIfNumber('D30', dLineResult.D30);
    addIfNumber('D60', dLineResult.D60);

    // D-linesは見やすい順に右→左になりがちなので、粒径でソートしておく
    items.sort((a, b) => a.mm - b.mm);

    return items.map((it) => ({
      ...it,
      x: Math.log10(it.mm),
      text: `${it.label} = ${it.mm.toFixed(3)} mm`,
    }));
  }, [dLineResult]);

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

        <label style={{ marginLeft: 12 }}>
          <input type="checkbox" checked={showCc} onChange={() => setShowCc(!showCc)} /> 曲率係数 (Cc) を表示
        </label>

        {/* ★ D-lines 表示ケース */}
        <label style={{ marginLeft: 12 }}>
          D10/D30/D60 表示ケース：
          <select
            value={dLineCase}
            onChange={(e) => setDLineCase(e.target.value)}
            style={{ marginLeft: 8 }}
          >
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
                {results.map((res) => (
                  <tr key={res.caseName}>
                    <td>{res.caseName}</td>
                    <td>{typeof res.D10 === 'number' ? res.D10.toFixed(3) : res.D10}</td>
                    <td>{typeof res.D30 === 'number' ? res.D30.toFixed(3) : res.D30}</td>
                    <td>{typeof res.D60 === 'number' ? res.D60.toFixed(3) : res.D60}</td>
                    <td>{typeof res.Cu === 'number' ? res.Cu.toFixed(2) : res.Cu}</td>
                    {showCc && <td>{typeof res.Cc === 'number' ? res.Cc.toFixed(2) : res.Cc}</td>}
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

            <XAxis
              dataKey="logSieveSize"
              type="number"
              domain={xDomain}
              ticks={xTicks}
              reversed={false}
              label={{ value: '粒径 (mm) [対数スケール]', position: 'insideBottom', offset: -15 }}
              tickFormatter={(tick) => {
                const mm = Math.pow(10, tick);
                // 目盛りが多いので、見やすく丸め
                if (mm >= 10) return String(Math.round(mm * 10) / 10);
                if (mm >= 1) return String(Math.round(mm * 100) / 100);
                return String(Math.round(mm * 1000) / 1000);
              }}
              allowDuplicatedCategory={false}
            />

            <YAxis
              label={{ value: '通過百分率 (%)', angle: -90, position: 'insideLeft' }}
              domain={[0, 100]}
              ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
            />

            <Tooltip content={<CustomTooltip />} />
            <Legend onClick={handleLegendClick} />

            {/* ★ D10/D30/D60 縦線 */}
            {dLines.map((dl) => (
              <ReferenceLine
                key={dl.label}
                x={dl.x}
                stroke="#777"
                strokeDasharray="4 4"
                label={{
                  value: dl.text,
                  position: 'insideTop',
                  fill: '#777',
                  fontSize: 12,
                }}
              />
            ))}

            {/* ★ プロットは「直線」でつなぐ */}
            {plottableCases.map((caseName) => {
              const caseIndex = cases.findIndex((c) => c === caseName);
              return (
                <Line
                  key={caseName}
                  type="linear"
                  dataKey={caseName}
                  stroke={visibleCases[caseName] ? chartColors[caseIndex % chartColors.length] : 'transparent'}
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
