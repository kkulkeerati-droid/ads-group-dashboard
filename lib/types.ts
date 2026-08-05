import type { GroupKey } from "./groups";

export type Platform = "meta" | "tiktok";
export type MetricKey = "spend" | "results" | "cpr" | "cpm" | "reach" | "impressions"
  | "roas" | "revenue" | "replies" | "cpReply" | "replyRate" | "purchases" | "convRate" | "basket";

// แถวข้อมูลดิบระดับ ad (ต่อวันถ้ามี date)
// metric คุณภาพ + ยอดขาย (แนบมากับทุก AdRow / ทุกระดับสรุป)
export interface QualityMetrics {
  replies: number;   // คนกลับมาตอบ (user ส่ง ≥2 ข้อความ) — กรองแชทผีออก
  purchases: number; // จำนวนออเดอร์ที่ Meta นับได้
  revenue: number;   // มูลค่ายอดขาย (THB)
}

export interface AdRow {
  platform: Platform;
  accountId: string;
  accountName: string;
  adName: string;
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  resultType?: string; // เช่น messaging / interactions / purchase
  date?: string; // YYYY-MM-DD (live รายวัน)
  replies?: number;   // คนกลับมาตอบ (depth_2)
  purchases?: number; // ออเดอร์
  revenue?: number;   // ยอดขาย
}

export interface Metricized {
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  cpm: number; // spend / impressions * 1000
  cpr: number; // spend / results (ต้นทุนต่อผลลัพธ์)
  // ── ตัวชี้ขาดจริง (ทัก ≠ ลูกค้า) ──
  replies: number;    // คนกลับมาตอบ admin
  replyRate: number;  // replies / results (%) — ต่ำ = แชทผีเยอะ
  cpReply: number;    // spend / replies — ต้นทุนต่อคนคุยจริง
  purchases: number;  // ออเดอร์
  revenue: number;    // ยอดขาย
  roas: number;       // revenue / spend
  convRate: number;   // purchases / results (%) — ทัก→ซื้อ
  basket: number;     // revenue / purchases
}

export interface GroupTotal extends Metricized {
  key: GroupKey | string;
  label: string;
  color: string;
  share: number; // สัดส่วน spend 0..1
  ads: number;
  resultType?: string; // ประเภทผลลัพธ์หลักของกลุ่ม
  target?: number; // เป้า CPR (บาท)
}

// ยอดงวดก่อนหน้า (สำหรับเทียบ %▲▼)
export interface PrevTotals {
  spend: number;
  results: number;
  reach: number;
  impressions: number;
  cpr: number;
  cpm: number;
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

// มิติวิเคราะห์ content ads (แกะจากชื่อแอด) — มุมคอนเทนต์ / กลุ่มเป้าหมาย
export interface ContentDim {
  key: string;
  spend: number;
  results: number;
  cpr: number;
  ads: number; // จำนวนแอดในมิตินี้
  replies: number; replyRate: number; cpReply: number;
  purchases: number; revenue: number; roas: number; convRate: number; basket: number;
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
  content?: { themes: ContentDim[]; audiences: ContentDim[]; products: ContentDim[] };
}
