import { useState } from 'react';
import Papa from 'papaparse';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
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

// Initial data
const initialSieveSizes: number[] = [53, 37.5, 31.5, 26.5, 19, 13.2, 4.75, 2.36, 0.425, 0.075];
const initialCases: string[] = Array.from({ length: 12 }, (_, i) => `Case ${i + 1}`);

const initialSieveData: SieveData[] = initialSieveSizes.map(size => ({
  sieveSize: size,
  ...initialCases.reduce((acc, caseName) => ({ ...acc, [caseName]: '' }), {})
}));

const chartColors = [
  '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
  '#9A6324', '#fffac8', '#800000', '#aaffc3', '#808080', '#ffd8b1',
  '#000075', '#a9a9a9'
];

function App() {
  const [sieveData, setSieveData] = useState<SieveData[]>(initialSieveData);
  const [cases, setCases] = useState<string[]>(initialCases);
  const [results, setResults] = useState<ResultData[]>([]);
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);
  const [showCc, setShowCc] = useState<boolean>(false);
  const [visibleCases, setVisibleCases] = useState<Record<string, boolean>>(
    initialCases.reduce((acc, caseName) => ({ ...acc, [caseName]: true }), {})
  );

  const handleLegendClick = (e: any) => {
    const { dataKey } = e;
    setVisibleCases(prev => ({ ...prev, [dataKey]: !prev[dataKey] }));
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

    cases.forEach(caseName => {
      let lastValue: number | null = null;
      sortedData.forEach(row => {
        const originalRowIndex = data.findIndex(d => d.sieveSize === row.sieveSize);
        const valueStr = row[caseName] as string;
        if (!valueStr || valueStr.trim() === '') {
          lastValue = null;
          return;
        }
        const value = parseFloat(valueStr);
        if (isNaN(value) || value < 0 || value > 100) {
          messages.push({ rowIndex: originalRowIndex, caseName, message: `0-100の値を入力`, type: 'error' });
        } else { // Only check for monotonic decrease if the value is valid
            if (lastValue !== null && value > lastValue) {
              messages.push({ rowIndex: originalRowIndex, caseName, message: `単調減少違反`, type: 'warning' });
            }
        }
        if (!isNaN(value)) {
          lastValue = value;
        }
      });
    });

    setValidationMessages(messages);
    return !messages.some(msg => msg.type === 'error');
  };

  const getDValue = (data: { passing: number; sieveSize: number }[], targetPercentage: number): number | string => {
    if (data.length < 2) return "データ不足";
    const sortedData = [...data].sort((a, b) => a.passing - b.passing);
    const logSieveSizes = sortedData.map(d => Math.log10(d.sieveSize));
    const passingPercentages = sortedData.map(d => d.passing);

    if (targetPercentage < passingPercentages[0] || targetPercentage > passingPercentages[passingPercentages.length - 1]) {
      return "範囲外";
    }

    let i = 0;
    while (i < passingPercentages.length && passingPercentages[i] < targetPercentage) {
      i++;
    }
    if (i === 0) i = 1;
    if (i === passingPercentages.length) i = passingPercentages.length - 1;

    const p1 = passingPercentages[i - 1];
    const p2 = passingPercentages[i];
    const d1_log = logSieveSizes[i - 1];
    const d2_log = logSieveSizes[i];

    if (p1 === p2) return Math.pow(10, d1_log);

    const logD = d1_log + ((d2_log - d1_log) * (targetPercentage - p1)) / (p2 - p1);
    return Math.pow(10, logD);
  };

  const handleCalculate = () => {
    if (!validateData(sieveData)) {
      alert("入力エラーがあります。計算を実行する前に修正してください。");
      return;
    }
    const newResults: ResultData[] = cases.map(caseName => {
      const validData = sieveData
        .map(row => ({
          sieveSize: row.sieveSize,
          passing: parseFloat(row[caseName] as string),
        }))
        .filter(item => !isNaN(item.passing) && item.sieveSize > 0);

      if (validData.length < 2) {
        return { caseName, D10: "N/A", D30: "N/A", D60: "N/A", Cu: "N/A", Cc: "N/A" };
      }

      const D10 = getDValue(validData, 10);
      const D30 = getDValue(validData, 30);
      const D60 = getDValue(validData, 60);

      let Cu: number | string = "N/A";
      let Cc: number | string = "N/A";

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
    setSieveData(sieveData.map(row => ({...row, [newCaseName]: ''})));
    setVisibleCases({...visibleCases, [newCaseName]: true });
  };

  const handleRemoveCase = () => {
    if (cases.length <= 1) return;
    const lastCaseName = cases.pop()!;
    setCases([...cases]);
    setSieveData(sieveData.map(row => {
      const newRow = {...row};
      delete newRow[lastCaseName];
      return newRow;
    }));
    const newVisibleCases = {...visibleCases};
    delete newVisibleCases[lastCaseName];
    setVisibleCases(newVisibleCases);
  };

  const handleDownloadCsv = () => {
    const csvData = Papa.unparse({
      fields: ['Sieve Size (mm)', ...cases],
      data: sieveData
    }) + '\n\n' + Papa.unparse({
      fields: ['Case', 'D10', 'D30', 'D60', 'Cu', ...(showCc ? ['Cc'] : [])],
      data: results.map(r => {
        const row = { Case: r.caseName, D10: r.D10, D30: r.D30, D60: r.D60, Cu: r.Cu };
        return showCc ? {...row, Cc: r.Cc} : row;
      })
    });
    const blob = new Blob([`\uFEFF${csvData}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'sieve_analysis_data.csv';
    link.click();
  };

  const chartData = useMemo(() => {
    const processedData = sieveData
      .map(row => {
        const newRow: { [key: string]: any } = { sieveSize: row.sieveSize };
        cases.forEach(caseName => {
          const valueStr = row[caseName] as string;
          if (valueStr === null || valueStr.trim() === '' || isNaN(parseFloat(valueStr))) {
            newRow[caseName] = null;
          } else {
            let value = parseFloat(valueStr);
            if (value < 0) value = 0;
            if (value > 100) value = 100;
            newRow[caseName] = value;
          }
        });
        return newRow;
      })
      .filter(row => row.sieveSize > 0);

    // Sort by sieveSize in descending order to ensure the line is drawn correctly
    processedData.sort((a, b) => b.sieveSize - a.sieveSize);

    return processedData;
  }, [sieveData, cases]);

  return (
    <div className="App">
      <h1>粒度試験分析 (Sieve Analysis)</h1>
      <div className="controls">
        <button onClick={handleCalculate}>計算実行</button>
        <button onClick={handleDownloadCsv}>CSVダウンロード</button>
        <button onClick={handleAddCase}>ケース列を追加</button>
        <button onClick={handleRemoveCase} disabled={cases.length <= 1}>ケース列を削除</button>
        <label><input type="checkbox" checked={showCc} onChange={() => setShowCc(!showCc)} /> 曲率係数 (Cc) を表示</label>
      </div>

      <h2>入力データ (通過百分率 %)</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>篩目 (mm)</th>
              {cases.map(caseName => <th key={caseName}>{caseName}</th>)}
            </tr>
          </thead>
          <tbody>
            {sieveData.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td><input type="number" value={row.sieveSize} onChange={(e) => handleSieveSizeChange(rowIndex, e.target.value)} className="sieve-size-input" /></td>
                {cases.map(caseName => {
                  const msg = validationMessages.find(m => m.rowIndex === rowIndex && m.caseName === caseName);
                  return (
                    <td key={caseName} className={msg ? `cell-${msg.type}` : ''} title={msg?.message}>
                      <input type="number" value={row[caseName]} onChange={(e) => handleInputChange(rowIndex, caseName, e.target.value)} min="0" max="100" step="any" />
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
                {results.map(res => (
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
        <ResponsiveContainer width="100%" height={500}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sieveSize" type="number" scale="log" domain={['auto', 'auto']} reversed={true} label={{ value: "粒径 (mm) [対数スケール]", position: 'insideBottom', offset: -15 }} tickFormatter={(tick) => tick.toString()} allowDuplicatedCategory={false}/>
            <YAxis label={{ value: "通過百分率 (%)", angle: -90, position: 'insideLeft' }} domain={[0, 100]} ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}/>
            <Tooltip formatter={(value: any) => `${Number(value).toFixed(2)}%`} labelFormatter={(label) => `粒径: ${label} mm`}/>
            <Legend onClick={handleLegendClick} />
            {cases.map((caseName, index) => (
              <Line key={caseName} type="monotone" dataKey={caseName} stroke={visibleCases[caseName] ? chartColors[index % chartColors.length] : 'transparent'} strokeWidth={2} dot={{ r: 3 }}/>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default App;
