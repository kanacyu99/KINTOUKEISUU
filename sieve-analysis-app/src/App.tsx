import { useState, useMemo } from 'react';
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
} from 'recharts';

/* =========================
   型定義
========================= */
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

/* =========================
   Tooltip 用ワークアラウンド
========================= */
interface CustomTooltipPayload {
  name: string;
  value: number;
  dataKey?: string;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayload[];
  label?: number | string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length && typeof label === 'number') {
    const originalSieveSize = Math.pow(10, label);

    return (
      <div className="custom-tooltip">
        <p>{`粒径: ${originalSieveSize.toFixed(3)} mm`}</p>
        {payload.map(p =>
          p.dataKey ? (
            <p key={p.dataKey} style={{ color: p.color }}>
              {`${p.dataKey}: ${Number(p.value).toFixed(2)} %`}
            </p>
          ) : null
        )}
      </div>
    );
  }
  return null;
};

/* =========================
   初期データ
========================= */
const initialSieveSizes = [53, 37.5, 31.5, 26.5, 19, 13.2, 4.75, 2.36, 0.425, 0.075];
const initialCases = Array.from({ length: 12 }, (_, i) => `Case ${i + 1}`);

const initialSieveData: SieveData[] = initialSieveSizes.map(size => ({
  sieveSize: size,
  ...initialCases.reduce((acc, c) => ({ ...acc, [c]: '' }), {}),
}));

const chartColors = [
  '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
];

/* =========================
   App
========================= */
function App() {
  const [sieveData, setSieveData] = useState<SieveData[]>(initialSieveData);
  const [cases, setCases] = useState<string[]>(initialCases);
  const [results, setResults] = useState<ResultData[]>([]);
  const [messages, setMessages] = useState<ValidationMessage[]>([]);
  const [showCc, setShowCc] = useState(true);
  const [visible, setVisible] = useState<Record<string, boolean>>(
    initialCases.reduce((a, c) => ({ ...a, [c]: true }), {})
  );

  const handleLegendClick = (e: LegendPayload) => {
    if (typeof e.dataKey === 'string') {
      setVisible(v => ({ ...v, [e.dataKey as string]: !v[e.dataKey as string] }));
    }
  };

  const validate = (data: SieveData[]) => {
    const errs: ValidationMessage[] = [];
    const sorted = [...data].sort((a, b) => b.sieveSize - a.sieveSize);

    cases.forEach(c => {
      let prev: number | null = null;
      sorted.forEach(row => {
        const idx = data.findIndex(d => d.sieveSize === row.sieveSize);
        const v = parseFloat(row[c] as string);
        if (isNaN(v)) return;

        if (v < 0 || v > 100) {
          errs.push({ rowIndex: idx, caseName: c, message: '0–100のみ', type: 'error' });
        }
        if (prev !== null && v > prev) {
          errs.push({ rowIndex: idx, caseName: c, message: '単調減少違反', type: 'warning' });
        }
        prev = v;
      });
    });

    setMessages(errs);
    return !errs.some(e => e.type === 'error');
  };

  const getD = (data: { sieveSize: number; passing: number }[], target: number) => {
    const s = [...data].sort((a, b) => a.passing - b.passing);
    if (s.length < 2) return 'N/A';
    if (target < s[0].passing || target > s[s.length - 1].passing) return '範囲外';

    let p1 = s[0], p2 = s[s.length - 1];
    for (let i = 0; i < s.length; i++) {
      if (s[i].passing <= target) p1 = s[i];
      if (s[i].passing >= target) { p2 = s[i]; break; }
    }

    const logD =
      Math.log10(p1.sieveSize) +
      (Math.log10(p2.sieveSize) - Math.log10(p1.sieveSize)) *
      ((target - p1.passing) / (p2.passing - p1.passing));

    return Math.pow(10, logD);
  };

  const calculate = () => {
    if (!validate(sieveData)) {
      alert('入力エラーがあります');
      return;
    }

    setResults(
      cases.map(c => {
        const d = sieveData
          .map(r => ({ sieveSize: r.sieveSize, passing: parseFloat(r[c] as string) }))
          .filter(v => !isNaN(v.passing) && v.sieveSize > 0);

        if (d.length < 2) return { caseName: c, D10: 'N/A', D30: 'N/A', D60: 'N/A', Cu: 'N/A', Cc: 'N/A' };

        const D10 = getD(d, 10);
        const D30 = getD(d, 30);
        const D60 = getD(d, 60);

        const Cu = typeof D10 === 'number' && typeof D60 === 'number' ? D60 / D10 : 'N/A';
        const Cc =
          typeof D10 === 'number' && typeof D30 === 'number' && typeof D60 === 'number'
            ? (D30 * D30) / (D10 * D60)
            : 'N/A';

        return { caseName: c, D10, D30, D60, Cu, Cc };
      })
    );
  };

  const chartData = useMemo(() => {
    return sieveData
      .map(r => {
        const row: any = {
          sieveSize: r.sieveSize,
          logSieveSize: r.sieveSize > 0 ? Math.log10(r.sieveSize) : null,
        };
        cases.forEach(c => {
          const v = parseFloat(r[c] as string);
          row[c] = isNaN(v) ? null : Math.max(0, Math.min(100, v));
        });
        return row;
      })
      .filter(r => r.sieveSize > 0)
      .sort((a, b) => b.sieveSize - a.sieveSize);
  }, [sieveData, cases]);

  return (
    <div>
      <h1>粒度試験分析 (Sieve Analysis)</h1>

      <button onClick={calculate}>計算実行</button>
      <label>
        <input type="checkbox" checked={showCc} onChange={() => setShowCc(!showCc)} />
        Cc 表示
      </label>

      <ResponsiveContainer width="100%" height={500}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="logSieveSize"
            type="number"
            reversed
            tickFormatter={t => Math.pow(10, t).toPrecision(2)}
          />
          <YAxis domain={[0, 100]} />
          <Tooltip content={<CustomTooltip />} />
          <Legend onClick={handleLegendClick} />
          {cases.map((c, i) => (
            <Line
              key={c}
              dataKey={c}
              stroke={visible[c] ? chartColors[i % chartColors.length] : 'transparent'}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default App;
