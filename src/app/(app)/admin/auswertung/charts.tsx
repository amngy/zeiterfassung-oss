"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TEAL = "#136860";
const LIME = "#8FB83E";
const MUTED = "#6B7A77";

const axis = { fontSize: 11, fill: MUTED };

export interface EmployeeBar {
  name: string;
  worked: number;
  expected: number;
}

/** Worked vs. contracted hours per employee for the period. */
export function EmployeeComparisonChart({ data }: { data: EmployeeBar[] }) {
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="#0000000d" />
        <XAxis type="number" tick={axis} unit=" h" />
        <YAxis type="category" dataKey="name" width={120} tick={axis} />
        <Tooltip
          formatter={(v) => [`${Number(v).toLocaleString("de-DE")} h`, ""]}
          contentStyle={{ borderRadius: 12, border: "1px solid #0000000f", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="worked" name="Ist" fill={TEAL} radius={[0, 4, 4, 0]} />
        <Bar dataKey="expected" name="Soll" fill={LIME} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface DayPoint {
  label: string;
  hours: number;
}

/** Worked hours summed across the team, per day. */
export function WorkedTrendChart({ data }: { data: DayPoint[] }) {
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid stroke="#0000000d" />
        <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={20} />
        <YAxis tick={axis} unit=" h" width={44} />
        <Tooltip
          formatter={(v) => [`${Number(v).toLocaleString("de-DE")} h`, "gearbeitet"]}
          contentStyle={{ borderRadius: 12, border: "1px solid #0000000f", fontSize: 12 }}
        />
        <Line type="monotone" dataKey="hours" stroke={TEAL} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function Empty() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-muted">
      Keine Daten für diesen Zeitraum.
    </div>
  );
}
