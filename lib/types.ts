import type { GroupKey } from "./groups";

export type Platform = "meta" | "tiktok";
export type MetricKey = "spend" | "results" | "cpr" | "cpm" | "reach" | "impressions" | "revenue" | "roas";

// แถวข้อมูลดิบระดับ ad (ต่อวันถ้ามี date)
export interface AdRow {
  platform: Platform;
  accountId: string;
  accountName: string;
  adName: string;
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  revenue?: number; // มูลค่าซื้อจาก pixel (action_values omni_purchase) — ใช้คิด ROAS
  purchases?: number; // จำนวนซื้อจาก pixel (actions omni_purchase)
  resultType?: string; // เช่น messaging / interactions / purchase
  date?: string; // YYYY-MM-DD (live รายวัน)
}

export interface Metricized {
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  cpm: number; // spend / impressions * 1000
  cpr: number; // spend / results (ต้นทุนต่อผลลัพธ์)
  revenue: number; // มูลค่าซื้อจาก pixel (รวม)
  purchases: number; // จำนวนซื้อจาก pixel (รวม)
  roas: number; // revenue / spend (pixel ROAS)
}

export interface GroupTotal extends Metricized {
  key: GroupKey | string;
  label: string;
  color: string;
  share: number; // สัดส่วน spend 0..1
  ads: number;
  resultType?: string; // ประเภทผลลัพธ์หลักของกลุ่ม
  target?: number; // เป้า CPR (บาท)
  roasTarget?: number; // เป้า ROAS (ยิ่งมากยิ่งดี)
  realRevenue?: number; // ยอดขายจริงที่ user กรอก (per กลุ่ม) — ถ้ามี
  realRoas?: number; // realRevenue / spend
}

// ยอดงวดก่อนหน้า (สำหรับเทียบ %▲▼)
export interface PrevTotals {
  spend: number;
  results: number;
  reach: number;
  impressions: number;
  cpr: number;
  cpm: number;
  revenue: number;
  roas: number;
  byGroup: Record<string, number>; // spend ต่อกลุ่ม
  since: string;
  until: string;
}

export interface AccountTotal extends Metricized {
  id: string;
  name: string;
  platform: Platform;
  byGroup: Record<string, number>; // spend ต่อกลุ่ม (ไว้ทำ stacked bar)
}

export interface TopAd extends Metricized {
  adName: string;
  group: string;
  accountName: string;
  platform: Platform;
}

export interface SeriesPoint {
  date: string;
  byGroup: Record<string, number>; // spend ต่อกลุ่มต่อวัน
  demo?: boolean;
}

export interface AccountIssue {
  id: string;
  name: string;
  status: string; // DISABLED / UNSETTLED / ...
  reason: string;
}

export interface Metrics extends Metricized {
  source: "supabase" | "live" | "demo";
  platform: "meta" | "tiktok" | "all";
  since: string;
  until: string;
  updatedAt: string;
  currency: string;
  groups: GroupTotal[];
  accounts: AccountTotal[];
  topAds: TopAd[];
  series: SeriesPoint[];
  accountIssues: AccountIssue[];
  warnings: string[];
  prev?: PrevTotals; // งวดก่อนหน้า (เทียบ)
}
