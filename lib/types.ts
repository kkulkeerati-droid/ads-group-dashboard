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
  /** ⭐ ตัวระบุแอดที่แท้จริง — ทีมตั้งชื่อแอดซ้ำกันทั้งชุด (1:1:3) ชื่อจึงไม่ใช่ key
   *  ว่างได้เฉพาะข้อมูลเก่าที่ sync ก่อนมี ad_id — ทุกที่ที่ใช้ต้อง fallback ไป adName */
  adId?: string;
  adName: string;
  /** ระดับ adset/campaign — ไว้ join targeting + งบจริงแทนการเดาจากชื่อ */
  adsetId?: string;
  adsetName?: string;
  campaignId?: string;
  campaignName?: string;
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  resultType?: string; // เช่น messaging / interactions / purchase
  date?: string; // YYYY-MM-DD (live รายวัน)
  replies?: number;   // คนกลับมาตอบ (depth_2)
  purchases?: number; // ออเดอร์ตามที่ Meta นับ (มี event มูลค่า ๐ ปนเยอะ — ดู purchasesValued)
  revenue?: number;   // ยอดขาย
  /** ออเดอร์ที่ "มีมูลค่าติดมาด้วย" — ตัวเดียวที่เอาไปนับบันไดออเดอร์ได้
   *  พิสูจน์ 11 ส.ค. 69: 3 ส.ค. P-FLOW 2 มี 61 ซื้อ แต่ 35 ตัว (57%) มูลค่า ๐
   *  แอด 1 CUT/Buy/600/1Aug ใช้ ฿6.41 แล้วนับ 11 ซื้อ มูลค่า ๐ — ไม่ใช่ออเดอร์จริง */
  purchasesValued?: number;
}

/** ตัวระบุแอดที่ใช้เป็น key ได้จริง — ข้อมูลเก่าไม่มี ad_id จึงถอยไปใช้ชื่อ
 *  ⚠️ ห้าม key ด้วย adName เปล่า ๆ ที่ไหนอีก (บั๊กราก 11 ส.ค. 69: ads คนละตัวชื่อซ้ำถูกรวมเป็นแถวเดียว) */
export function adKey(r: { accountId: string; adId?: string; adName: string }): string {
  return `${r.accountId}::${r.adId || r.adName}`;
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
  purchases: number;  // ออเดอร์ตามที่ Meta นับ (เทียบ Ads Manager ได้ แต่มี event มูลค่า ๐ ปน)
  /** ออเดอร์ที่มีมูลค่าติดมาด้วย — ใช้ตัวนี้ตัดสินใจ ไม่ใช่ purchases */
  purchasesValued: number;
  /** purchases − purchasesValued · สูง = metric ต้นทางเสีย ไม่ใช่ขายไม่ออก */
  zeroValuePurchases: number;
  revenue: number;    // ยอดขาย
  roas: number;       // revenue / spend
  convRate: number;   // purchasesValued / results (%) — ทัก→ซื้อ
  basket: number;     // revenue / purchasesValued
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
  /** ad_id จริงจาก Meta — ว่างได้เฉพาะข้อมูลเก่าก่อน migration 0003 */
  adId?: string;
  adName: string;
  /** ชื่อซ้ำกันในบัญชีเดียวกี่ตัว (1 = ไม่ซ้ำ) — ใช้ตัดสินว่าต้องโชว์ท้าย ad_id กำกับไหม */
  nameDupes?: number;
  group: string;
  accountName: string;
  platform: Platform;
  /** จำนวนวันที่แอดตัวนี้มีข้อมูลในช่วงที่ดู — < 3 = ยังอยู่ learning ห้ามแตะ */
  activeDays?: number;
}

// ─── targeting/งบจริงระดับ adset (อ่านจาก Meta แทนการเดาจากชื่อแอด) ──────
export interface AdsetInfo {
  platform: Platform;
  accountId: string;
  adsetId: string;
  adsetName: string;
  campaignId?: string;
  campaignName?: string;
  /** งบต่อวันจริง (บาท) — ถ้า null คือใช้งบระดับแคมเปญ (CBO) */
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  createdTime?: string;      // ISO — อายุจริงของ adset (ไม่ต้องเดาจากวันที่ในชื่อ)
  effectiveStatus?: string;
  ageMin?: number;
  ageMax?: number;
  genders?: string;          // all | male | female
  countries?: string;        // TH,... (คั่นด้วย comma)
  interests: number;         // จำนวน interest ที่เลือก
  customAudiences: number;   // จำนวน custom audience ที่ include
  excludedAudiences: number; // จำนวนที่ exclude
  lookalikes: number;
  platforms?: string;        // facebook,instagram,...
  /** ไม่มี interest + ไม่มี custom audience = ปล่อยกว้างจริง (broad) */
  isBroad: boolean;
  updatedAt?: string;
}

export interface SeriesPoint {
  date: string;
  byGroup: Record<string, number>; // spend ต่อกลุ่มต่อวัน
  byFunnel?: Record<string, number>; // spend ต่อชั้น funnel ต่อวัน (TOF/MOF/BOF/?)
  demo?: boolean;
}

// ─── funnel (แกะจากชื่อแอด — ดู lib/ae.ts classifyFunnel) ──────────────
export interface FunnelTotal extends Metricized {
  stage: string; // TOF | MOF | BOF | ?
  label: string;
  color: string;
  share: number; // สัดส่วน spend 0..1
  ads: number;
  /** ส่วนที่อ่านจาก "ค่าเริ่มต้น" (ชื่อไม่ได้บอกกลุ่ม) — หลักฐานอ่อนกว่าอ่านจากชื่อ */
  assumedSpend: number;
  assumedAds: number;
}

export interface FunnelProductCell { spend: number; share: number; roas: number; ads: number }

export interface FunnelProductRow {
  product: string;
  spend: number;
  roas: number;
  purchases: number;
  cells: Record<string, FunnelProductCell>; // key = stage
  missing: string[]; // ชั้นที่ยังไม่มีงบเลย
  note: string;
}

export interface NamingGapRow {
  adName: string;
  accountName: string;
  product: string;
  spend: number;
  revenue: number;
  roas: number;
  suggested: string | null; // ชื่อที่ควรเปลี่ยนเป็น (ก๊อปไปวางใน Ads Manager ได้เลย)
  /** แอดชื่อนี้ในบัญชีนี้มีกี่ตัว — >1 คือต้องไปเปลี่ยนชื่อหลายตัว ไม่ใช่ตัวเดียว */
  ads: number;
}

// มิติวิเคราะห์ content ads (แกะจากชื่อแอด) — มุมคอนเทนต์ / กลุ่มเป้าหมาย
export interface ContentDim {
  key: string;
  spend: number;
  results: number;
  cpr: number;
  ads: number; // จำนวนแอดในมิตินี้
  replies: number; replyRate: number; cpReply: number;
  purchases: number; purchasesValued: number; zeroValuePurchases: number;
  revenue: number; roas: number; convRate: number; basket: number;
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
  content?: { themes: ContentDim[]; audiences: ContentDim[]; products: ContentDim[]; funnels: ContentDim[] };
  funnel?: { rows: FunnelTotal[]; notes: string[] };
  funnelProducts?: FunnelProductRow[];
  naming?: { count: number; spend: number; share: number; rows: NamingGapRow[] };
  /** targeting/งบจริงระดับ adset (snapshot ล่าสุด ไม่ใช่รายวัน) */
  adsets?: AdsetInfo[];
  /** สุขภาพข้อมูล — ไว้กันเอาเลขที่เชื่อไม่ได้ไปตัดสินใจ */
  quality?: {
    /** แถวที่ยังไม่มี ad_id (sync ก่อน migration 0003) — >0 = ตัวเลขรายแอดยังรวมชื่อซ้ำอยู่ */
    rowsWithoutAdId: number;
    /** สัดส่วนออเดอร์ที่ไม่มีมูลค่าติดมา 0..1 — สูง = purchases/basket/convRate เชื่อไม่ได้ */
    zeroValueShare: number;
    notes: string[];
  };
}
