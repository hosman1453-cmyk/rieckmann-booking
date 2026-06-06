"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin    from "@fullcalendar/daygrid";
import timeGridPlugin   from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";

// ─── Types ────────────────────────────────────────────────────────────────────
type Therapist = { id: number; name: string; active?: boolean | null; color?: string | null; };
type Appointment = { id: number; name: string | null; service: string | null; date: string | null; time: string | null; therapist_id: number | null; };
type Block = { id: number; therapist_id: number; date: string; start_time: string; end_time: string; reason?: string | null; recurring?: boolean; };
type Patient = { id: number; name: string; phone?: string | null; email?: string | null; birth_date?: string | null; notes?: string | null; };
type TherapistHours = { id?: number; therapist_id: number; day_of_week: number; start_time: string; end_time: string; is_working: boolean; };
type Verfuegbar = { id?: number; therapist_id: number; day_of_week: number; start_time: string; end_time: string; is_available: boolean; };
type HausbesuchSetting = { id?: number; therapist_id: number; region: string; day_of_week: number; start_time: string; end_time: string; is_active: boolean; };
type CalendarView = "timeGridDay" | "timeGridWeek" | "dayGridMonth";
type SidePanel = "calendar" | "patients" | "therapists" | "stats" | "settings";
type Toast = { id: string; type: "success" | "error" | "info"; message: string; };
type ContextMenu = { x: number; y: number; date: string; time: string; } | null;
type SelectedEvent = { id: string; title: string; therapistName: string; isBlock: boolean; } | null;
type AppointmentDetails = {
  id: number;
  appointment_id: number;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  message: string | null;
  dsgvo_accepted: boolean;
  prescription_urls: string[] | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = ["#1a56a0","#b5451b","#1a6b3a","#6b21a8","#0e7490","#92400e"];
const DAYS_DE   = ["So","Mo","Di","Mi","Do","Fr","Sa"];
const DAYS_FULL = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sanitize(v: unknown, fb = ""): string { return String(v ?? "").trim().replace(/<[^>]*>/g, "") || fb; }
function todayISO(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function dateToISO(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }
function parseRange(date: string|null, time: string|null) {
  if (!date||!time) return null;
  const dm = String(date).match(/^(\d{4}-\d{2}-\d{2})/); if (!dm) return null;
  const parts = String(time).split(" - ").map(p=>p.trim());
  const sm = parts[0]?.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/); if (!sm) return null;
  const start = `${dm[1]}T${sm[1]}:${sm[2]}:${sm[3]??"00"}`; if (isNaN(new Date(start).getTime())) return null;
  const em = parts[1]?.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  const end = em ? `${dm[1]}T${em[1]}:${em[2]}:${em[3]??"00"}` : undefined;
  return { start, end };
}
function getMiniCalDays(year: number, month: number) {
  const first = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();
  const cells: {day:number; month:"prev"|"cur"|"next"; fullDate:string}[] = [];
  const startOffset = first === 0 ? 6 : first-1;
  for (let i=startOffset; i>0; i--) {
    const pm = month===0?11:month-1; const py = month===0?year-1:year;
    cells.push({day:daysInPrev-i+1, month:"prev", fullDate:`${py}-${String(pm+1).padStart(2,"0")}-${String(daysInPrev-i+1).padStart(2,"0")}`});
  }
  for (let i=1; i<=daysInMonth; i++) cells.push({day:i, month:"cur", fullDate:`${year}-${String(month+1).padStart(2,"0")}-${String(i).padStart(2,"0")}`});
  while (cells.length%7!==0) {
    const nm = month===11?0:month+1; const ny = month===11?year+1:year;
    const d = cells.length-daysInMonth-startOffset+1;
    cells.push({day:d, month:"next", fullDate:`${ny}-${String(nm+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`});
  }
  return cells;
}
function getWeekMonday(offset: number): Date {
  const d = new Date(); const day = d.getDay();
  const diff = (day===0?-6:1-day);
  d.setDate(d.getDate()+diff+(offset*7)); d.setHours(0,0,0,0); return d;
}
function weekLabel(offset: number): string {
  const mon = getWeekMonday(offset); const sun = new Date(mon); sun.setDate(sun.getDate()+6);
  return `${String(mon.getDate()).padStart(2,"0")}.${String(mon.getMonth()+1).padStart(2,"0")} – ${String(sun.getDate()).padStart(2,"0")}.${String(sun.getMonth()+1).padStart(2,"0")}.${sun.getFullYear()}`;
}
function normTimeInput(t: string | null | undefined, fallback = "09:00"): string {
  if (!t) return fallback;
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : fallback;
}
function toDbTime(t: string): string {
  const n = normTimeInput(t);
  return n.length === 5 ? `${n}:00` : n;
}
function eventDurationMinutes(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60000);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const calRef  = useRef<InstanceType<typeof FullCalendar>>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [authOk, setAuthOk] = useState(false);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [hours, setHours] = useState<TherapistHours[]>([]);
  const [verfuegbar, setVerfuegbar] = useState<Verfuegbar[]>([]);
  const [hausbesuch, setHausbesuch] = useState<HausbesuchSetting[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);

  const [selTherapists, setSelTherapists] = useState<Set<number>>(new Set());
  const [view, setView] = useState<CalendarView>("timeGridWeek");
  const [calTitle, setCalTitle] = useState("");
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<SidePanel>("calendar");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isLoading, setLoading] = useState(true);

  const today = new Date();
  const [miniYear, setMiniYear] = useState(today.getFullYear());
  const [miniMonth, setMiniMonth] = useState(today.getMonth());
  const [selectedMiniDate, setSelectedMiniDate] = useState<string>(todayISO());

  const [ctxMenu, setCtxMenu] = useState<ContextMenu>(null);
  const [delTarget, setDelTarget] = useState<SelectedEvent>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailPanel, setDetailPanel] = useState<{
    eventId: string; title: string; therapistName: string;
    start: string; end?: string; durationMinutes: number | null;
    service: string; isBlock: boolean;
  }|null>(null);
  const [aptDetails, setAptDetails] = useState<AppointmentDetails|null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [blockModal, setBlockModal] = useState<{date:string;startTime:string;endTime:string;therapistId:number;allDay:boolean}|null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [blockRecurring, setBlockRecurring] = useState(false);

  // Hours + Verfuegbar modal (combined)
  const [scheduleModal, setScheduleModal] = useState<Therapist|null>(null);
  const [hoursEdit, setHoursEdit] = useState<TherapistHours[]>([]);
  const [verfuegEdit, setVerfuegEdit] = useState<Verfuegbar[]>([]);
  const [scheduleTab, setScheduleTab] = useState<"arbeitszeiten"|"verfuegbar">("arbeitszeiten");
  const [hoursWeekOffset, setHoursWeekOffset] = useState(0);
  const [applyToAllWeeks, setApplyToAllWeeks] = useState(false);

  const [addThModal, setAddThModal] = useState(false);
  const [hausbesuchModal, setHausbesuchModal] = useState<Therapist|null>(null);
  const [hausbesuchEdit, setHausbesuchEdit] = useState<HausbesuchSetting[]>([]);
  const [savingHausbesuch, setSavingHausbesuch] = useState(false);
  const [newThName, setNewThName] = useState("");
  const [savingTh, setSavingTh] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");

  // ── Toast ─────────────────────────────────────────────────────────────────
  const toast = useCallback((type: Toast["type"], message: string) => {
    const id = uid();
    setToasts(p=>[...p,{id,type,message}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), 4000);
  },[]);

  const colorMap = useMemo(()=>{
    const m: Record<number,string> = {};
    therapists.forEach((t,i)=>{ m[t.id]= t.color || COLORS[i%COLORS.length]; });
    return m;
  },[therapists]);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const ensureAuth = useCallback(async ()=>{
    const {data,error} = await supabase.auth.getUser();
    if (error||!data?.user) { router.replace("/login"); return false; }
    return true;
  },[router]);

  // ── Fetches ───────────────────────────────────────────────────────────────
  const fetchTherapists = useCallback(async ()=>{
    const {data,error} = await supabase.from("therapists").select("id,name,active,color").eq("active",true).order("name",{ascending:true});
    if (error) { toast("error",`Therapeuten: ${error.message}`); return []; }
    const list = (data??[]) as Therapist[];
    setTherapists(list);
    setSelTherapists(p=>p.size>0?p:new Set(list.map(t=>t.id)));
    return list;
  },[toast]);

  const fetchAppointments = useCallback(async (tList: Therapist[])=>{
    const {data,error} = await supabase.from("appointments").select("id,name,service,date,time,therapist_id").order("date",{ascending:true}).order("time",{ascending:true});
    if (error) { toast("error","Termine konnten nicht geladen werden."); return; }
    const raw = (data??[]) as Appointment[];
    setAllAppointments(raw);
    const cm: Record<number,string> = {};
    tList.forEach((t,i)=>{ cm[t.id]= t.color || COLORS[i%COLORS.length]; });
    const fmt = raw.map(item=>{
      const range = parseRange(item.date, item.time); if (!range) return null;
      const th = tList.find(p=>p.id===item.therapist_id);
      const name = sanitize(item.name,"Unbekannt"); const service = sanitize(item.service,"Termin");
      const color = item.therapist_id!=null?(cm[item.therapist_id]??"#555"):"#555";
      return {
        id:String(item.id), title:name, start:range.start, end:range.end, allDay:false,
        backgroundColor:color, borderColor:color, textColor:"#fff",
        extendedProps:{ therapistId:item.therapist_id, therapistName:sanitize(th?.name,"–"), patientName:name, serviceName:service, isBlock:false, searchable:`${name} ${service} ${th?.name??""}`.toLowerCase() },
      } satisfies EventInput;
    }).filter(Boolean) as EventInput[];
    setEvents(prev=>{ const blocks=prev.filter(e=>String(e.id).startsWith("block-")||String(e.id).startsWith("work-")); return [...fmt,...blocks]; });
  },[toast]);

  const fetchBlocks = useCallback(async (tList: Therapist[])=>{
    const {data,error} = await supabase.from("blocks").select("id,therapist_id,date,start_time,end_time,reason,recurring");
    if (error) { toast("error","Blocks konnten nicht geladen werden."); return; }
    const bEvents: EventInput[] = ((data??[]) as Block[]).map(b=>{
      const th = tList.find(t=>t.id===b.therapist_id);
      return { id:`block-${b.id}`, title:b.reason||"Blockiert", start:`${b.date}T${b.start_time}`, end:`${b.date}T${b.end_time}`, allDay:false, backgroundColor:"#ea580c", borderColor:"#c2410c", textColor:"#fff", extendedProps:{ therapistId:b.therapist_id, therapistName:sanitize(th?.name,""), isBlock:true, recurring:b.recurring, searchable:`blockiert ${th?.name??""}`.toLowerCase() } };
    });
    setEvents(prev=>{ const appts=prev.filter(e=>!String(e.id).startsWith("block-")&&!String(e.id).startsWith("work-")); return [...appts,...bEvents]; });
  },[toast]);

  const fetchPatients = useCallback(async ()=>{
    const {data,error} = await supabase.from("patients").select("id,name,phone,email,birth_date,notes").order("name",{ascending:true});
    if (error) { toast("error","Patienten konnten nicht geladen werden."); return; }
    setPatients((data??[]) as Patient[]);
  },[toast]);

  const fetchHours = useCallback(async ()=>{
    const {data,error} = await supabase.from("therapist_hours").select("id,therapist_id,day_of_week,start_time,end_time,is_working");
    if (error) { toast("error","Arbeitszeiten konnten nicht geladen werden."); return; }
    setHours((data??[]) as TherapistHours[]);
  },[toast]);

  const fetchVerfuegbar = useCallback(async ()=>{
    const {data,error} = await supabase.from("verfuegbarzeiten").select("id,therapist_id,day_of_week,start_time,end_time,is_available");
    if (error) { console.warn("verfuegbarzeiten fetch error:", error.message); return; }
    const rows = (data??[]) as Verfuegbar[];
    console.log("verfuegbar rows loaded:", rows.length, rows);
    setVerfuegbar(rows);
  },[]);

  const fetchHausbesuch = useCallback(async ()=>{
    const {data,error} = await supabase.from("hausbesuch_settings")
      .select("id,therapist_id,region,day_of_week,start_time,end_time,is_active");
    if (error) {
      console.warn("hausbesuch fetch error:", error.message);
      toast("error", `Hausbesuch konnte nicht geladen werden: ${error.message}`);
      return;
    }
    setHausbesuch((data??[]) as HausbesuchSetting[]);
  },[toast]);

  const fetchStats = useCallback(async (tList: Therapist[], appts: Appointment[])=>{
    // Compute stats client-side to avoid view dependency
    const statsData = tList.map(t=>{
      const tAppts = appts.filter(a=>a.therapist_id===t.id);
      const now = new Date(); const today = dateToISO(now);
      const d30 = new Date(now); d30.setDate(d30.getDate()-30); const d30s = dateToISO(d30);
      const d7f = new Date(now); d7f.setDate(d7f.getDate()+7); const d7s = dateToISO(d7f);
      const last30 = tAppts.filter(a=>a.date&&a.date>=d30s&&a.date<=today).length;
      const next7  = tAppts.filter(a=>a.date&&a.date>=today&&a.date<=d7s).length;
      const tHours = hours.filter(h=>h.therapist_id===t.id&&h.is_working);
      const weeklyH = tHours.reduce((s,h)=>{
        const [sh,sm] = h.start_time.split(":").map(Number); const [eh,em] = h.end_time.split(":").map(Number);
        return s + (eh*60+em - sh*60-sm)/60;
      }, 0);
      const weeklySlots = weeklyH * 2; // 30min slots approximation
      const occupancy = weeklySlots > 0 ? Math.round(Math.min((next7/weeklySlots)*100,100)) : 0;
      return { therapist_id:t.id, therapist_name:t.name, total:tAppts.length, last30, next7, weeklyH:Math.round(weeklyH*10)/10, occupancy };
    });
    setStats(statsData);
  },[hours]);

  const reload = useCallback(async ()=>{
    setLoading(true);
    const ok = await ensureAuth(); if(!ok) return;
    const tList = await fetchTherapists();
    const [,,,appts] = await Promise.all([fetchBlocks(tList), fetchPatients(), fetchHours(), (async()=>{ const {data} = await supabase.from("appointments").select("id,name,service,date,time,therapist_id"); return (data??[]) as Appointment[]; })()]);
    await fetchAppointments(tList);
    await fetchVerfuegbar();
    await fetchHausbesuch();
    if (appts) await fetchStats(tList, appts);
    setLoading(false);
  },[ensureAuth,fetchTherapists,fetchAppointments,fetchBlocks,fetchPatients,fetchHours,fetchVerfuegbar,fetchHausbesuch,fetchStats]);

  useEffect(()=>{
    (async()=>{
      const {data,error} = await supabase.auth.getUser();
      if (error||!data?.user) { router.replace("/login"); return; }
      setAuthOk(true); reload();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Re-compute stats when hours or allAppointments change
  useEffect(()=>{
    if (therapists.length && allAppointments.length) fetchStats(therapists, allAppointments);
  },[therapists, allAppointments, hours, fetchStats]);

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      if((e.metaKey||e.ctrlKey)&&e.key==="k"){ e.preventDefault(); searchRef.current?.focus(); }
      if(e.key==="Escape"){ setCtxMenu(null); setDelTarget(null); setBlockModal(null); setScheduleModal(null); setAddThModal(false); setDetailPanel(null); setAptDetails(null); }
    };
    window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h);
  },[]);

  // ── Working hours as real background events ─────────────────────────────
  const workingBgEvents = useMemo(()=>{
    const bg: EventInput[] = [];
    const base = new Date();
    const activeList = therapists.filter(t=>selTherapists.has(t.id));
    for (let offset=-7; offset<=60; offset++){
      const d = new Date(base); d.setDate(d.getDate()+offset);
      const dow = d.getDay();
      const ds = dateToISO(d);
      for (const t of activeList){
        const color = t.color || colorMap[t.id] || "#22c55e";
        const vRows = verfuegbar.filter(v=>v.therapist_id===t.id&&v.day_of_week===dow&&v.is_available);
        const hRow  = hours.find(x=>x.therapist_id===t.id&&x.day_of_week===dow&&x.is_working);
        if (vRows.length > 0) {
          vRows.forEach((v,vi)=>{
            bg.push({
              id:`bg-${t.id}-${ds}-${vi}`,
              start:`${ds}T${v.start_time}`,
              end:`${ds}T${v.end_time}`,
              display:"background",
              color,
              extendedProps:{ isBg:true, therapistColor:color },
            });
          });
        } else if (hRow) {
          bg.push({
            id:`bg-${t.id}-${ds}`,
            start:`${ds}T${hRow.start_time}`,
            end:`${ds}T${hRow.end_time}`,
            display:"background",
            color,
            extendedProps:{ isBg:true, therapistColor:color },
          });
        }
      }
    }
    return bg;
  },[therapists,selTherapists,hours,verfuegbar,colorMap]);


  const visibleEvents = useMemo(()=>{
    const q = search.trim().toLowerCase();
    // Filter only real events (appointments + blocks), not bg
    const filtered = events.filter(ev=>{
      const tid = Number(ev.extendedProps?.therapistId);
      return selTherapists.has(tid) && (!q||String(ev.extendedProps?.searchable??"").includes(q));
    });
    // Append background events — they are never filtered
    return [...filtered, ...workingBgEvents];
  },[events,search,selTherapists,workingBgEvents]);

  // ── Calendar nav ─────────────────────────────────────────────────────────
  const switchView=(v:CalendarView)=>{ setView(v); calRef.current?.getApi().changeView(v); };
  const navigate=(dir:"prev"|"next"|"today")=>{
    const api=calRef.current?.getApi(); if(!api) return;
    if(dir==="prev")api.prev(); else if(dir==="next")api.next(); else api.today();
    setCalTitle(api.view.title);
  };

  const openCtxAt = useCallback((clientX:number, clientY:number, dateStr:string, timeStr:string)=>{
    const x=Math.min(clientX,window.innerWidth-220); const y=Math.min(clientY+4,window.innerHeight-170);
    setCtxMenu({x,y,date:dateStr,time:timeStr});
  },[]);
  const handleDateClick = useCallback((info:DateClickArg)=>{
    openCtxAt(info.jsEvent.clientX,info.jsEvent.clientY,info.dateStr.slice(0,10),info.dateStr.length>10?info.dateStr.slice(11,16):"09:00");
  },[openCtxAt]);
  const handleEventClick = useCallback(async(info:EventClickArg)=>{
    const ev=info.event;
    if(ev.display==="background") return;
    if(ev.extendedProps?.isBg) return;
    const isBlock = Boolean(ev.extendedProps.isBlock);
    setDetailPanel({
      eventId: ev.id,
      title: ev.title,
      therapistName: String(ev.extendedProps.therapistName??""),
      start: ev.startStr,
      end: ev.endStr || undefined,
      durationMinutes: eventDurationMinutes(ev.start, ev.end),
      service: String(ev.extendedProps.serviceName??""),
      isBlock,
    });
    setAptDetails(null);
    if(!isBlock){
      setLoadingDetails(true);
      const rawId = String(ev.id).trim();
      const{data}=await supabase.from("appointment_details")
        .select("*").eq("appointment_id",rawId).single();
      setAptDetails(data as AppointmentDetails|null);
      setLoadingDetails(false);
    }
  },[]);
  useEffect(()=>{
    if(!ctxMenu) return;
    const h=(e:MouseEvent)=>{ if(!(e.target as HTMLElement).closest(".ctx-menu")) setCtxMenu(null); };
    setTimeout(()=>document.addEventListener("click",h),10);
    return()=>document.removeEventListener("click",h);
  },[ctxMenu]);

  // ── Context menu ──────────────────────────────────────────────────────────
  const ctxBook=()=>{ if(!ctxMenu) return; setCtxMenu(null); router.push(`/book?date=${ctxMenu.date}&time=${ctxMenu.time}`); };
  const ctxBlock=()=>{
    if(!ctxMenu) return;
    const h=parseInt(ctxMenu.time.split(":")[0]); const endH=Math.min(h+1,20);
    const endTime=`${String(endH).padStart(2,"0")}:${ctxMenu.time.split(":")[1]||"00"}`;
    const tid=selTherapists.size===1?[...selTherapists][0]:therapists[0]?.id??0;
    setBlockModal({date:ctxMenu.date,startTime:ctxMenu.time,endTime,therapistId:tid,allDay:false});
    setBlockReason(""); setBlockRecurring(false); setCtxMenu(null);
  };
  const ctxBlockDay=()=>{
    if(!ctxMenu) return;
    const tid=selTherapists.size===1?[...selTherapists][0]:therapists[0]?.id??0;
    setBlockModal({date:ctxMenu.date,startTime:"00:00",endTime:"23:59",therapistId:tid,allDay:true});
    setBlockReason(""); setBlockRecurring(false); setCtxMenu(null);
  };

  // ── Save block (with recurring option) ───────────────────────────────────
  const saveBlock = useCallback(async()=>{
    if(!blockModal||!blockModal.therapistId) { toast("error","Therapeuten wählen."); return; }
    const ok=await ensureAuth(); if(!ok) return;
    if (!blockRecurring) {
      const {error}=await supabase.from("blocks").insert({ therapist_id:blockModal.therapistId, date:blockModal.date, start_time:blockModal.startTime, end_time:blockModal.endTime, reason:blockReason||null, recurring:false });
      if(error){ toast("error",`Block-Fehler: ${error.message}`); return; }
    } else {
      // Insert for the next 52 weeks (1 year)
      const rows = [];
      const baseDate = new Date(blockModal.date+"T12:00:00");
      for (let w=0; w<52; w++){
        const d = new Date(baseDate); d.setDate(d.getDate()+(w*7));
        rows.push({ therapist_id:blockModal.therapistId, date:dateToISO(d), start_time:blockModal.startTime, end_time:blockModal.endTime, reason:blockReason||null, recurring:true });
      }
      const {error}=await supabase.from("blocks").insert(rows);
      if(error){ toast("error",`Fehler: ${error.message}`); return; }
    }
    toast("success", blockRecurring ? "Zeitblock für 52 Wochen gespeichert." : "Zeitblock gespeichert.");
    setBlockModal(null);
    const tl=await fetchTherapists(); await fetchBlocks(tl);
  },[blockModal,blockReason,blockRecurring,ensureAuth,fetchTherapists,fetchBlocks,toast]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const confirmDelete = useCallback(async()=>{
    if(!delTarget) return; setDeleting(true);
    const ok=await ensureAuth(); if(!ok){ setDeleting(false); return; }
    if(delTarget.isBlock){
      const blockRawId = String(delTarget.id).replace("block-","").trim();
      if(!blockRawId){ toast("error","Ungültige Block-ID."); setDeleting(false); setDelTarget(null); return; }
      const {error}=await supabase.from("blocks").delete().eq("id",blockRawId);
      if(error) toast("error",`Fehler: ${error.message}`);
      else{ toast("success","Block entfernt."); const tl=await fetchTherapists(); await fetchBlocks(tl); }
    } else {
      const rawId = String(delTarget.id).trim();
      if(!rawId || rawId === "undefined" || rawId === "null"){
        toast("error", "Ungültige Termin-ID.");
        setDeleting(false); setDelTarget(null); return;
      }
      const {error}=await supabase.from("appointments").delete().eq("id", rawId);
      if(error){ console.error("DELETE error:", error); toast("error",`Fehler: ${error.message}`); }
      else{ toast("success","Termin gelöscht."); const tl=await fetchTherapists(); await fetchAppointments(tl); }
    }
    setDeleting(false); setDelTarget(null);
  },[delTarget,ensureAuth,fetchTherapists,fetchBlocks,fetchAppointments,toast]);

  // ── Schedule modal (Arbeitszeiten + Verfügbarzeiten) ──────────────────────
  const openScheduleModal=(t:Therapist)=>{
    setHoursWeekOffset(0); setApplyToAllWeeks(false); setScheduleTab("arbeitszeiten");
    const existing = DAYS_FULL.map((_,dow)=>{
      const h=hours.find(x=>x.therapist_id===t.id&&x.day_of_week===dow);
      return h??{therapist_id:t.id,day_of_week:dow,start_time:"08:00",end_time:"18:00",is_working:dow>=1&&dow<=5};
    });
    setHoursEdit(existing);
    const vExisting = DAYS_FULL.map((_,dow)=>{
      const v=verfuegbar.find(x=>x.therapist_id===t.id&&x.day_of_week===dow);
      const h=hours.find(x=>x.therapist_id===t.id&&x.day_of_week===dow);
      return v??{therapist_id:t.id,day_of_week:dow,start_time:h?.start_time??"08:00",end_time:h?.end_time??"18:00",is_available:h?.is_working??(dow>=1&&dow<=5)};
    });
    setVerfuegEdit(vExisting);
    setScheduleModal(t);
  };

  const saveSchedule = useCallback(async()=>{
    if(!scheduleModal) return;
    const ok=await ensureAuth(); if(!ok) return;
    if(scheduleTab==="arbeitszeiten"){
      const rows=hoursEdit.map(h=>({ therapist_id:scheduleModal.id, day_of_week:h.day_of_week, start_time:h.start_time, end_time:h.end_time, is_working:h.is_working }));
      const {error}=await supabase.from("therapist_hours").upsert(rows,{onConflict:"therapist_id,day_of_week"});
      if(error){ toast("error",`Fehler: ${error.message}`); return; }
      if(applyToAllWeeks) toast("info","Standardzeiten gespeichert — gelten ab sofort für alle kommenden Wochen.");
      else toast("success","Arbeitszeiten gespeichert.");
    } else {
      const rows=verfuegEdit.map(v=>({ therapist_id:scheduleModal.id, day_of_week:v.day_of_week, start_time:v.start_time, end_time:v.end_time, is_available:v.is_available }));
      const {error}=await supabase.from("verfuegbarzeiten").upsert(rows,{onConflict:"therapist_id,day_of_week,start_time"});
      if(error){ toast("error",`Fehler: ${error.message}`); return; }
      toast("success","Verfügbarzeiten gespeichert.");
    }
    setScheduleModal(null);
    await fetchHours(); await fetchVerfuegbar();
    const tl=await fetchTherapists(); await fetchBlocks(tl);
  },[scheduleModal,scheduleTab,hoursEdit,verfuegEdit,applyToAllWeeks,ensureAuth,fetchHours,fetchVerfuegbar,fetchTherapists,fetchBlocks,toast]);

  // ── Add therapist ─────────────────────────────────────────────────────────
  const REGIONS = [
    {id:"peterhausen",label:"Peterhausen",icon:"📍"},
    {id:"allensbach",label:"Allensbach",icon:"📍"},
    {id:"reichenau",label:"Reichenau",icon:"📍"},
  ];
  const DAYS_FULL_HB = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];

  const openHausbesuchModal=(t:Therapist)=>{
    const rows:HausbesuchSetting[]=[];
    for(const region of ["peterhausen","allensbach","reichenau"]){
      for(let dow=0;dow<=6;dow++){
        const existing=hausbesuch.find(h=>h.therapist_id===t.id&&h.region===region&&h.day_of_week===dow);
        rows.push(existing?{
          ...existing,
          start_time:normTimeInput(existing.start_time,"09:00"),
          end_time:normTimeInput(existing.end_time,"17:00"),
        }:{therapist_id:t.id,region,day_of_week:dow,start_time:"09:00",end_time:"17:00",is_active:false});
      }
    }
    setHausbesuchEdit(rows);
    setHausbesuchModal(t);
  };

  const saveHausbesuch=useCallback(async()=>{
    if(!hausbesuchModal||savingHausbesuch)return;
    const ok=await ensureAuth();if(!ok)return;
    const tid=hausbesuchModal.id;
    const activeRows=hausbesuchEdit.filter(h=>h.is_active);
    setSavingHausbesuch(true);
    const{error:delError}=await supabase.from("hausbesuch_settings").delete().eq("therapist_id",tid);
    if(delError){
      setSavingHausbesuch(false);
      toast("error",`Hausbesuch speichern fehlgeschlagen: ${delError.message}`);
      return;
    }
    if(activeRows.length>0){
      const rows=activeRows.map(h=>({
        therapist_id:tid,region:h.region,
        day_of_week:h.day_of_week,start_time:toDbTime(h.start_time),end_time:toDbTime(h.end_time),is_active:true,
      }));
      const{error}=await supabase.from("hausbesuch_settings").insert(rows);
      if(error){
        setSavingHausbesuch(false);
        toast("error",`Hausbesuch speichern fehlgeschlagen: ${error.message}`);
        fetchHausbesuch();
        return;
      }
    }
    setHausbesuch(prev=>[
      ...prev.filter(h=>h.therapist_id!==tid),
      ...activeRows.map(h=>({...h,therapist_id:tid,is_active:true})),
    ]);
    setSavingHausbesuch(false);
    setHausbesuchModal(null);
    toast("success","Hausbesuch-Einstellungen gespeichert.");
    fetchHausbesuch();
  },[hausbesuchModal,hausbesuchEdit,savingHausbesuch,ensureAuth,fetchHausbesuch,toast]);

  const saveTherapist=useCallback(async()=>{
    const name=newThName.trim(); if(!name){ toast("error","Name darf nicht leer sein."); return; }
    setSavingTh(true); const ok=await ensureAuth(); if(!ok){ setSavingTh(false); return; }
    const {data,error}=await supabase.from("therapists").insert({name,active:true}).select();
    if(error){ toast("error",`Fehler: ${error.message}`); setSavingTh(false); return; }
    toast("success",`${name} wurde hinzugefügt.`);
    setNewThName(""); setAddThModal(false); setSavingTh(false);
    if(data&&data[0]){
      const newId=data[0].id;
      const defaultH=[1,2,3,4,5].map(dow=>({therapist_id:newId,day_of_week:dow,start_time:"08:00",end_time:"18:00",is_working:true}));
      await supabase.from("therapist_hours").upsert(defaultH,{onConflict:"therapist_id,day_of_week"});
      await fetchHours();
    }
    const tl=await fetchTherapists(); await fetchAppointments(tl);
  },[newThName,ensureAuth,fetchTherapists,fetchAppointments,fetchHours,toast]);

  const handleSignOut=useCallback(async()=>{ await supabase.auth.signOut(); router.replace("/login"); },[router]);

  const filteredPatients=useMemo(()=>{
    const q=patientSearch.trim().toLowerCase(); if(!q) return patients;
    return patients.filter(p=>p.name.toLowerCase().includes(q)||(p.phone??"").includes(q)||(p.email??"").toLowerCase().includes(q));
  },[patients,patientSearch]);

  const miniDays=useMemo(()=>getMiniCalDays(miniYear,miniMonth),[miniYear,miniMonth]);
  const sidebarTitle=useMemo(()=>{
    if(selTherapists.size===1){ const id=[...selTherapists][0]; return therapists.find(t=>t.id===id)?.name??"Therapeut"; }
    return selTherapists.size===0?"Keiner ausgewählt":"Alle Therapeuten";
  },[selTherapists,therapists]);

  if(!authOk) return null;

  return (
    <>
      {/* Toasts */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t=>(
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}
            <button className="toast-x" onClick={()=>setToasts(p=>p.filter(x=>x.id!==t.id))}>×</button>
          </div>
        ))}
      </div>

      {/* Context menu */}
      {ctxMenu&&(
        <div className="ctx-menu" style={{top:ctxMenu.y,left:ctxMenu.x}}>
          <div className="ctx-header">{ctxMenu.date} · {ctxMenu.time} Uhr</div>
          <button className="ctx-item ctx-book" onClick={ctxBook}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
            Termin buchen
          </button>
          <button className="ctx-item ctx-block" onClick={ctxBlock}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            Zeit blockieren
          </button>
          <button className="ctx-item ctx-day" onClick={ctxBlockDay}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="14" x2="16" y2="14"/></svg>
            Ganzen Tag blockieren
          </button>
        </div>
      )}

      {/* Delete confirm */}
      {delTarget&&(
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-icon">{delTarget.isBlock?"🔒":"🗑"}</div>
            <h3 className="modal-title">{delTarget.isBlock?"Block entfernen?":"Termin löschen?"}</h3>
            <p className="modal-body"><strong>{delTarget.title}</strong><br/><span className="modal-meta">{delTarget.therapistName}</span></p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>setDelTarget(null)}>Abbrechen</button>
              <button className="btn-danger" onClick={confirmDelete} disabled={deleting}>{deleting?"…":"Löschen"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Block modal */}
      {blockModal&&(
        <div className="modal-backdrop">
          <div className="modal modal-wide">
            <h3 className="modal-title">⛔ Zeit blockieren</h3>
            <div className="form-grid">
              <label className="form-label">Datum<input className="form-input" type="date" value={blockModal.date} onChange={e=>setBlockModal(p=>p?{...p,date:e.target.value}:p)}/></label>
              <label className="form-label">Therapeut
                <select className="form-input" value={blockModal.therapistId} onChange={e=>setBlockModal(p=>p?{...p,therapistId:Number(e.target.value)}:p)}>
                  <option value={0}>— Bitte wählen —</option>
                  {therapists.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              {!blockModal.allDay&&<>
                <label className="form-label">Von<input className="form-input" type="time" value={blockModal.startTime} onChange={e=>setBlockModal(p=>p?{...p,startTime:e.target.value}:p)}/></label>
                <label className="form-label">Bis<input className="form-input" type="time" value={blockModal.endTime} onChange={e=>setBlockModal(p=>p?{...p,endTime:e.target.value}:p)}/></label>
              </>}
              {blockModal.allDay&&<div className="form-allday" style={{gridColumn:"1/-1"}}>Ganzer Tag: 00:00 – 23:59</div>}
              <label className="form-label" style={{gridColumn:"1/-1"}}>Grund (optional)<input className="form-input" type="text" value={blockReason} onChange={e=>setBlockReason(e.target.value)} placeholder="z.B. Urlaub, Fortbildung…"/></label>
            </div>

            {/* Recurring option */}
            <label className="recurring-row">
              <input type="checkbox" checked={blockRecurring} onChange={e=>setBlockRecurring(e.target.checked)}/>
              <div>
                <span className="recurring-label">Für alle kommenden Wochen blockieren</span>
                <span className="recurring-sub">Gleiche Uhrzeit wird 52 Wochen lang blockiert</span>
              </div>
            </label>

            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>setBlockModal(null)}>Abbrechen</button>
              <button className="btn-orange" onClick={saveBlock}>
                {blockRecurring?"🔁 Dauerhaft blockieren":"⛔ Blockieren"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule modal (Arbeitszeiten + Verfügbarzeiten) */}
      {scheduleModal&&(
        <div className="modal-backdrop" onClick={e=>{ if(e.target===e.currentTarget) setScheduleModal(null); }}>
          <div className="modal modal-xl modal-scrollable" onClick={e=>e.stopPropagation()}>
            <h3 className="modal-title">📅 Zeiten — {scheduleModal.name}</h3>

            {/* Tab switcher */}
            <div className="sched-tabs">
              <button className={`sched-tab${scheduleTab==="arbeitszeiten"?" active":""}`} onClick={()=>setScheduleTab("arbeitszeiten")}>
                🏢 Arbeitszeiten
              </button>
              <button className={`sched-tab${scheduleTab==="verfuegbar"?" active":""}`} onClick={()=>setScheduleTab("verfuegbar")}>
                ✅ Verfügbarzeiten
              </button>
            </div>

            <div className="modal-body-scroll">
            {scheduleTab==="arbeitszeiten"&&(
              <>
                {/* Week nav */}
                <div className="week-nav">
                  <button className="week-btn" onClick={()=>setHoursWeekOffset(w=>w-1)}>‹</button>
                  <div className="week-info">
                    <span className="week-label">{hoursWeekOffset===0?"Diese Woche":hoursWeekOffset===1?"Nächste Woche":hoursWeekOffset===-1?"Letzte Woche":`Woche ${hoursWeekOffset>0?"+":""}${hoursWeekOffset}`}</span>
                    <span className="week-dates">{weekLabel(hoursWeekOffset)}</span>
                  </div>
                  <button className="week-btn" onClick={()=>setHoursWeekOffset(w=>w+1)}>›</button>
                </div>
                <p className="hours-hint">Standardmäßige Wochenarbeitszeiten — gelten für alle Wochen</p>
                <table className="hours-table">
                  <thead><tr><th>Tag</th><th>Arbeitstag</th><th>Von</th><th>Bis</th></tr></thead>
                  <tbody>
                    {hoursEdit.map((h,i)=>(
                      <tr key={h.day_of_week} className={h.is_working?"":"row-off"}>
                        <td className="day-label">{DAYS_FULL[h.day_of_week]}</td>
                        <td><input type="checkbox" checked={h.is_working} onChange={e=>setHoursEdit(p=>p.map((x,j)=>j===i?{...x,is_working:e.target.checked}:x))}/></td>
                        <td><input className="form-input time-input" type="time" value={h.start_time} disabled={!h.is_working} onChange={e=>setHoursEdit(p=>p.map((x,j)=>j===i?{...x,start_time:e.target.value}:x))}/></td>
                        <td><input className="form-input time-input" type="time" value={h.end_time} disabled={!h.is_working} onChange={e=>setHoursEdit(p=>p.map((x,j)=>j===i?{...x,end_time:e.target.value}:x))}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Apply to all weeks toggle */}
                <label className="apply-all-row">
                  <input type="checkbox" checked={applyToAllWeeks} onChange={e=>setApplyToAllWeeks(e.target.checked)}/>
                  <div>
                    <span className="apply-all-label">Diese Zeiten als Standard für alle kommenden Wochen verwenden</span>
                    <span className="apply-all-sub">Überschreibt keine manuellen Ausnahmen</span>
                  </div>
                </label>
              </>
            )}

            {scheduleTab==="verfuegbar"&&(
              <>
                <p className="hours-hint">Verfügbarzeiten werden im Kalender als farbiger Hintergrund angezeigt und bestimmen buchbare Zeiten im Termin-buchen-System.</p>
                <table className="hours-table">
                  <thead><tr><th>Tag</th><th>Verfügbar</th><th>Von</th><th>Bis</th></tr></thead>
                  <tbody>
                    {verfuegEdit.map((v,i)=>(
                      <tr key={v.day_of_week} className={v.is_available?"":"row-off"}>
                        <td className="day-label">{DAYS_FULL[v.day_of_week]}</td>
                        <td><input type="checkbox" checked={v.is_available} onChange={e=>setVerfuegEdit(p=>p.map((x,j)=>j===i?{...x,is_available:e.target.checked}:x))}/></td>
                        <td><input className="form-input time-input" type="time" value={v.start_time} disabled={!v.is_available} onChange={e=>setVerfuegEdit(p=>p.map((x,j)=>j===i?{...x,start_time:e.target.value}:x))}/></td>
                        <td><input className="form-input time-input" type="time" value={v.end_time} disabled={!v.is_available} onChange={e=>setVerfuegEdit(p=>p.map((x,j)=>j===i?{...x,end_time:e.target.value}:x))}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="verfueg-info">
                  <span className="vi-dot" style={{background:"rgba(34,197,94,0.3)"}}/>Grüner Hintergrund im Kalender = Verfügbar
                </div>
              </>
            )}
            </div>

            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>setScheduleModal(null)}>Abbrechen</button>
              <button className="btn-primary-sm" onClick={saveSchedule}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      {/* Add therapist modal */}
      {addThModal&&(
        <div className="modal-backdrop">
          <div className="modal">
            <h3 className="modal-title">👤 Therapeut hinzufügen</h3>
            <label className="form-label" style={{display:"block",marginBottom:20,textAlign:"left"}}>Name
              <input className="form-input" type="text" value={newThName} onChange={e=>setNewThName(e.target.value)} placeholder="Vorname Nachname" autoFocus onKeyDown={e=>{ if(e.key==="Enter") saveTherapist(); }}/>
            </label>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>{ setAddThModal(false); setNewThName(""); }}>Abbrechen</button>
              <button className="btn-primary-sm" onClick={saveTherapist} disabled={savingTh}>{savingTh?"Speichert…":"Hinzufügen"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hausbesuch Modal ── */}
      {hausbesuchModal&&(
        <div className="modal-backdrop" onClick={e=>{ if(e.target===e.currentTarget) setHausbesuchModal(null); }}>
          <div className="modal modal-xl modal-scrollable" onClick={e=>e.stopPropagation()}>
            <h3 className="modal-title">🏠 Hausbesuch — {hausbesuchModal.name}</h3>
            <div className="modal-body-scroll">
              {["peterhausen","allensbach","reichenau"].map(region=>(
                <div key={region} className="hb-region-block">
                  <div className="hb-region-title">📍 {region.charAt(0).toUpperCase()+region.slice(1)}</div>
                  <table className="hours-table">
                    <thead><tr><th>Tag</th><th>Aktiv</th><th>Von</th><th>Bis</th></tr></thead>
                    <tbody>
                      {DAYS_FULL_HB.map((dayName,dow)=>{
                        const idx=hausbesuchEdit.findIndex(h=>h.region===region&&h.day_of_week===dow);
                        const row=hausbesuchEdit[idx];
                        if(!row)return null;
                        return(
                          <tr key={dow} className={row.is_active?"":"row-off"}>
                            <td className="day-label">{dayName}</td>
                            <td><input type="checkbox" checked={row.is_active}
                              onChange={e=>setHausbesuchEdit(p=>p.map((x,i)=>i===idx?{...x,is_active:e.target.checked}:x))}/></td>
                            <td><input className="form-input time-input" type="time" value={row.start_time} disabled={!row.is_active}
                              onChange={e=>setHausbesuchEdit(p=>p.map((x,i)=>i===idx?{...x,start_time:e.target.value}:x))}/></td>
                            <td><input className="form-input time-input" type="time" value={row.end_time} disabled={!row.is_active}
                              onChange={e=>setHausbesuchEdit(p=>p.map((x,i)=>i===idx?{...x,end_time:e.target.value}:x))}/></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>setHausbesuchModal(null)}>Abbrechen</button>
              <button className="btn-primary-sm" onClick={saveHausbesuch} disabled={savingHausbesuch}>{savingHausbesuch?"Speichert…":"Speichern"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Panel ── */}
      {detailPanel&&(
        <div className={`detail-panel${detailPanel?" open":""}`}>
          <div className="dp-header">
            <div>
              <div className="dp-title">{detailPanel.isBlock?"⛔ Block":"📅 Termin"}</div>
              <div className="dp-name">{detailPanel.title}</div>
            </div>
            <button className="dp-close" onClick={()=>{setDetailPanel(null);setAptDetails(null);}}>×</button>
          </div>

          <div className="dp-body">
            <div className="dp-row"><span className="dp-lbl">Therapeut</span><span className="dp-val">{detailPanel.therapistName}</span></div>
            <div className="dp-row"><span className="dp-lbl">Zeit</span><span className="dp-val">{new Date(detailPanel.start).toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short"})}{detailPanel.end?` – ${new Date(detailPanel.end).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}`:""}</span></div>
            {detailPanel.durationMinutes!=null&&<div className="dp-row"><span className="dp-lbl">Dauer</span><span className="dp-val">{detailPanel.durationMinutes} Min.</span></div>}
            {!detailPanel.isBlock&&detailPanel.service&&<div className="dp-row"><span className="dp-lbl">Behandlung</span><span className="dp-val">{detailPanel.service}</span></div>}

            {!detailPanel.isBlock&&<>
              <div className="dp-divider"/>
              {loadingDetails&&<div className="dp-loading">Lädt…</div>}
              {!loadingDetails&&aptDetails&&<>
                {aptDetails.patient_name&&<div className="dp-row"><span className="dp-lbl">Patient</span><span className="dp-val">{aptDetails.patient_name}</span></div>}
                {aptDetails.patient_phone&&<div className="dp-row"><span className="dp-lbl">Telefon</span><a href={`tel:${aptDetails.patient_phone}`} className="dp-link">{aptDetails.patient_phone}</a></div>}
                {aptDetails.patient_email&&<div className="dp-row"><span className="dp-lbl">E-Mail</span><a href={`mailto:${aptDetails.patient_email}`} className="dp-link">{aptDetails.patient_email}</a></div>}
                {aptDetails.message&&<>
                  <div className="dp-divider"/>
                  <div className="dp-lbl">Nachricht</div>
                  <div className="dp-message">{aptDetails.message}</div>
                </>}
                {aptDetails.prescription_urls&&aptDetails.prescription_urls.length>0&&<>
  <div className="dp-divider"/>
  <div className="dp-lbl">Verordnung des Arztes</div>
  <div className="dp-files">
    {aptDetails.prescription_urls.map((url,i)=>{
      const isPdf=url.toLowerCase().includes(".pdf");
      const fileName = url.split('/').pop() || '';
      
      return(
        <button 
          key={i} 
          onClick={async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              
              if (!token) {
                alert('Bitte erneut anmelden.');
                return;
              }
              
              const response = await fetch('/api/prescription', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ fileName })
              });
              
              if (!response.ok) {
                alert('Dokument konnte nicht geladen werden.');
                return;
              }
              
              const { signedUrl } = await response.json();
              window.open(signedUrl, '_blank');
              
            } catch (err) {
              alert('Fehler beim Laden des Dokuments.');
            }
          }}
          className="dp-file"
          style={{ 
            cursor: 'pointer', 
            border: 'none', 
            width: '100%', 
            textAlign: 'left',
            background: 'transparent',
            fontFamily: 'inherit',
            fontSize: 'inherit'
          }}
        >
          {isPdf?"📄":"🖼️"} Dokument {i+1} öffnen
        </button>
      );
    })}
  </div>
</>}
                {!aptDetails.patient_name&&!aptDetails.patient_phone&&!aptDetails.message&&
                  <div className="dp-empty">Keine Patientendaten vorhanden.</div>
                }
              </>}
              {!loadingDetails&&!aptDetails&&<div className="dp-empty">Keine Zusatzinfos verfügbar.</div>}
            </>}
          </div>

          <div className="dp-footer">
            <button className="dp-delete-btn" onClick={()=>{
              setDetailPanel(null);
              setDelTarget({id:detailPanel.eventId,title:detailPanel.title,therapistName:detailPanel.therapistName,isBlock:detailPanel.isBlock});
            }}>
              🗑 {detailPanel.isBlock?"Block entfernen":"Termin löschen"}
            </button>
          </div>
        </div>
      )}
      {detailPanel&&<div className="dp-overlay" onClick={()=>{setDetailPanel(null);setAptDetails(null);}}/>}

      {/* ── Shell ── */}
      <main className="dashboard">
        {/* Rail */}
        <aside className="icon-rail">
          <div className="rail-logo">PB</div>
          {(["calendar","patients","therapists","stats","settings"] as SidePanel[]).map((p,i)=>{
            const SVGs=[
              <svg key="0" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>,
              <svg key="1" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
              <svg key="2" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
              <svg key="3" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
              <svg key="4" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
            ];
            return <button key={p} className={`rail-item${panel===p?" rail-active":""}`} onClick={()=>setPanel(p)} title={p}>{SVGs[i]}</button>;
          })}
          <div className="rail-spacer"/>
          <button className="rail-item rail-signout" onClick={handleSignOut} title="Abmelden">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </aside>

        {/* Side panel */}
        <aside className="side-panel">

          {/* CALENDAR PANEL */}
          {panel==="calendar"&&<>
            <button className="new-booking" onClick={()=>router.push("/book")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Neuer Termin
            </button>
            <div className="mini-cal">
              <div className="mini-cal-hdr">
                <button onClick={()=>{ if(miniMonth===0){setMiniMonth(11);setMiniYear(y=>y-1);}else setMiniMonth(m=>m-1); }}>‹</button>
                <span>{MONTHS_DE[miniMonth]} {miniYear}</span>
                <button onClick={()=>{ if(miniMonth===11){setMiniMonth(0);setMiniYear(y=>y+1);}else setMiniMonth(m=>m+1); }}>›</button>
              </div>
              <div className="mini-grid wd-row">{DAYS_DE.map((d,i)=><span key={i}>{d}</span>)}</div>
              <div className="mini-grid">
                {miniDays.map((c,i)=>{
                  const isSelected = c.fullDate === selectedMiniDate;
                  return (
                    <span key={i} className={`mday${c.month!=="cur"?" dim":""}${isSelected?" td":""}`}
                      onClick={()=>{
                        setSelectedMiniDate(c.fullDate);
                        calRef.current?.getApi().gotoDate(c.fullDate);
                        if(view!=="timeGridDay") switchView("timeGridDay");
                      }}>
                      {c.day}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="divider"/>
            <span className="plabel">Filiale</span>
            <div className="clinic-chip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Physiotherapie Rieckmann
            </div>
            <div className="divider"/>
            <div className="plabel-row">
              <span className="plabel">Therapeuten</span>
              <button className="link-btn" onClick={()=>setSelTherapists(p=>p.size===therapists.length?new Set():new Set(therapists.map(t=>t.id)))}>
                {selTherapists.size===therapists.length?"Alle abwählen":"Alle"}
              </button>
            </div>
            <div className="th-list">
              {therapists.map(t=>(
                <label key={t.id} className={`th-row${selTherapists.has(t.id)?" chk":""}`}>
                  <input type="checkbox" checked={selTherapists.has(t.id)} onChange={()=>setSelTherapists(p=>{ const n=new Set(p); n.has(t.id)?n.delete(t.id):n.add(t.id); return n; })}/>
                  <span className="cdot" style={{background:colorMap[t.id]}}/>
                  <span className="th-name">{t.name}</span>
                  {selTherapists.has(t.id)&&<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                </label>
              ))}
            </div>
            <div className="divider"/>
            <div className="legend">
              <div className="leg-row"><span className="leg-sw green"/>Verfügbar / Arbeitszeit</div>
              <div className="leg-row"><span className="leg-sw orange"/>Blockiert</div>
            </div>
            <div className="stat-card">
              <span className="stat-lbl">Sichtbar</span>
              <span className="stat-num">{visibleEvents.filter(e=>!String(e.id).startsWith("work-")).length}</span>
              <span className="stat-sub">Termine &amp; Blocks</span>
            </div>
          </>}

          {/* PATIENTS PANEL */}
          {panel==="patients"&&<>
            <h2 className="p-title">Patienten</h2>
            <div className="sbox">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={patientSearch} onChange={e=>setPatientSearch(e.target.value)} placeholder="Name, Telefon, E-Mail…" className="sbox-input"/>
              {patientSearch&&<button className="clr" onClick={()=>setPatientSearch("")}>×</button>}
            </div>
            <div className="p-count">{filteredPatients.length} Patient{filteredPatients.length!==1?"en":""}</div>
            <div className="p-list">
              {filteredPatients.length===0&&<div className="empty">Keine Patienten gefunden.</div>}
              {filteredPatients.map(p=>{
                const pAppts=allAppointments.filter(a=>a.name&&a.name.trim().toLowerCase()===p.name.trim().toLowerCase());
                const lastService=pAppts.length>0?pAppts[pAppts.length-1].service:null;
                return(
                <div key={p.id} className="p-card">
                  <div className="p-avatar">{p.name.slice(0,1).toUpperCase()}</div>
                  <div style={{flex:1}}>
                    <div className="p-name">{p.name}</div>
                    {(p as any).phone&&<div className="p-meta">📞 {(p as any).phone}</div>}
                    {p.email&&<div className="p-meta">✉️ {p.email}</div>}
                    {lastService&&<div className="p-meta p-service">🩺 {lastService}</div>}
                    <div className="p-meta p-count-lbl">{pAppts.length} Termin{pAppts.length!==1?"e":""}</div>
                  </div>
                </div>
                );
              })}
            </div>
          </>}

          {/* THERAPISTS PANEL */}
          {panel==="therapists"&&<>
            <div className="ptitle-row">
              <h2 className="p-title">Therapeuten</h2>
              <button className="btn-sm-red" onClick={()=>setAddThModal(true)}>+ Neu</button>
            </div>
            <div className="tmgmt">
              {therapists.map(t=>(
                <div key={t.id} className="tmgmt-card">
                  <div className="color-picker-wrap" title="Farbe wählen">
                    <span className="cdot cdot-large" style={{background:colorMap[t.id]}}/>
                    <input type="color" className="color-picker-input" value={colorMap[t.id]||"#1a56a0"}
                      onChange={async(e)=>{
                        const newColor = e.target.value;
                        setTherapists(prev=>prev.map(x=>x.id===t.id?{...x,color:newColor}:x));
                        const ok = await ensureAuth(); if(!ok) return;
                        const {error} = await supabase.from("therapists").update({color:newColor}).eq("id",t.id);
                        if(error){
                          toast("error", /color/i.test(error.message) ? "Farbe: Spalte fehlt — Supabase-Migration ausführen." : `Farbe konnte nicht gespeichert werden: ${error.message}`);
                          return;
                        }
                        const tl = await fetchTherapists();
                        await fetchAppointments(tl);
                        toast("success",`Farbe für ${t.name} gespeichert.`);
                      }}
                    />
                  </div>
                  <div className="tmgmt-info">
                    <span className="tmgmt-name">{t.name}</span>
                    <span className="tmgmt-sub">{hours.filter(h=>h.therapist_id===t.id&&h.is_working).length} Arbeitstage · 🏠 {hausbesuch.filter(h=>h.therapist_id===t.id&&h.is_active).length} HB</span>
                  </div>
                  <div style={{display:"flex",gap:"4px"}}>
                    <button className="btn-hours" onClick={()=>openScheduleModal(t)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      Zeiten
                    </button>
                    <button className="btn-hours btn-hb" onClick={()=>openHausbesuchModal(t)}
                      title={`Hausbesuch: ${hausbesuch.filter(h=>h.therapist_id===t.id&&h.is_active).length} aktiv`}>
                      🏠
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>}

          {/* STATS PANEL */}
          {panel==="stats"&&<>
            <h2 className="p-title">Statistiken</h2>
            <div className="stats-list">
              {stats.map(s=>{
                const color = colorMap[s.therapist_id]??"#6366f1";
                return (
                  <div key={s.therapist_id} className="stats-card">
                    <div className="stats-header">
                      <span className="cdot" style={{background:color,width:"10px",height:"10px"}}/>
                      <span className="stats-name">{s.therapist_name}</span>
                    </div>
                    <div className="stats-grid">
                      <div className="stat-item">
                        <span className="si-val">{s.total}</span>
                        <span className="si-lbl">Gesamt</span>
                      </div>
                      <div className="stat-item">
                        <span className="si-val">{s.last30}</span>
                        <span className="si-lbl">Letzten 30T</span>
                      </div>
                      <div className="stat-item">
                        <span className="si-val">{s.next7}</span>
                        <span className="si-lbl">Nächste 7T</span>
                      </div>
                      <div className="stat-item">
                        <span className="si-val">{s.weeklyH}h</span>
                        <span className="si-lbl">Wo./Stunden</span>
                      </div>
                    </div>
                    {/* Occupancy bar */}
                    <div className="occ-row">
                      <span className="occ-lbl">Auslastung (nächste 7T)</span>
                      <span className="occ-pct">{s.occupancy}%</span>
                    </div>
                    <div className="occ-bar">
                      <div className="occ-fill" style={{width:`${s.occupancy}%`, background:color}}/>
                    </div>
                  </div>
                );
              })}
              {stats.length===0&&<div className="empty">Keine Daten verfügbar.</div>}
            </div>

            {/* Overall summary */}
            {stats.length>0&&(
              <div className="stats-summary">
                <div className="ss-row">
                  <span>Gesamt Termine</span>
                  <strong>{stats.reduce((s,x)=>s+x.total,0)}</strong>
                </div>
                <div className="ss-row">
                  <span>Aktive Therapeuten</span>
                  <strong>{therapists.length}</strong>
                </div>
                <div className="ss-row">
                  <span>Ø Termine / Therapeut</span>
                  <strong>{therapists.length?Math.round(stats.reduce((s,x)=>s+x.total,0)/therapists.length):0}</strong>
                </div>
                <div className="ss-row">
                  <span>Termine nächste 7 Tage</span>
                  <strong>{stats.reduce((s,x)=>s+x.next7,0)}</strong>
                </div>
              </div>
            )}
          </>}

          {/* SETTINGS PANEL */}
          {panel==="settings"&&<>
            <h2 className="p-title">Einstellungen</h2>
            <div className="settings">
              <div className="s-item">Praxis: Physiotherapie Rieckmann</div>
              <div className="s-item">Sprache: Deutsch</div>
              <button className="btn-ghost full-w" style={{marginTop:8}} onClick={handleSignOut}>Abmelden</button>
            </div>
          </>}

        </aside>

        {/* Content */}
        <section className="content">
          <header className="topbar">
            <div className="tnav">
              <button className="nav-btn" onClick={()=>navigate("today")}>Heute</button>
              <button className="nav-btn icn" onClick={()=>navigate("prev")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
              <button className="nav-btn icn" onClick={()=>navigate("next")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
              <h1 className="cal-title">{calTitle||"Mai 2026"}</h1>
            </div>
            <div className="tright">
              <div className="srch-wrap">
                <svg className="srch-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Suchen… ⌘K" maxLength={80} className="srch-input" aria-label="Termine suchen"/>
                {search&&<button className="clr abs" onClick={()=>setSearch("")}>×</button>}
              </div>
              <div className="vtabs">
                {(["timeGridDay","timeGridWeek","dayGridMonth"] as CalendarView[]).map((v,i)=>(
                  <button key={v} className={`vtab${view===v?" on":""}`} onClick={()=>switchView(v)}>{["Tag","Woche","Monat"][i]}</button>
                ))}
              </div>
              <button className="btn-red" onClick={()=>router.push("/book")}>+ Termin</button>
              <button className="reload-btn" onClick={reload} disabled={isLoading} title="Neu laden">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={isLoading?"spin":""}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              </button>
            </div>
          </header>

          <div className="res-bar">
            <div className="res-avatar" style={{
              background:selTherapists.size===1?colorMap[[...selTherapists][0]]+"22":"#e0e7ff",
              color:selTherapists.size===1?colorMap[[...selTherapists][0]]:"#4338ca",
            }}>{sidebarTitle.slice(0,1).toUpperCase()}</div>
            <div>
              <h2 className="res-name">{sidebarTitle}</h2>
              <span className="res-sub">{visibleEvents.filter(e=>!String(e.id).startsWith("work-")).length} Einträge sichtbar</span>
            </div>
          </div>

          <div className="cal-area">
            {isLoading?(
              <div className="skel">{Array.from({length:18}).map((_,i)=><div key={i} className="skel-row"/>)}</div>
            ):(
              <FullCalendar
                ref={calRef}
                plugins={[dayGridPlugin,timeGridPlugin,interactionPlugin]}
                initialView={view}
                headerToolbar={false}
                events={visibleEvents}
                height="calc(100vh - 182px)"
                nowIndicator
                slotMinTime="07:00:00"
                slotMaxTime="21:00:00"
                allDaySlot={false}
                locale="de"
                initialDate={todayISO()}
                navLinks={true}
                navLinkDayClick={(date,jsEvent)=>{ const ev=jsEvent as MouseEvent; openCtxAt(ev.clientX,ev.clientY,dateToISO(date),"08:00"); }}
                dateClick={handleDateClick}
                eventClick={handleEventClick}
                datesSet={arg=>setCalTitle(arg.view.title)}
                eventDidMount={(info)=>{
                  if(info.event.display==="background"){
                    const col: string = String(info.event.extendedProps?.therapistColor || "#888888");
                    const hex = col.startsWith("#") ? col.replace("#","") : "888888";
                    const fullHex = hex.length===3 ? hex.split("").map(c=>c+c).join("") : hex.padEnd(6,"0");
                    const r = parseInt(fullHex.substring(0,2),16); const safeR=isNaN(r)?136:r;
                    const g = parseInt(fullHex.substring(2,4),16); const safeG=isNaN(g)?136:g;
                    const b = parseInt(fullHex.substring(4,6),16); const safeB=isNaN(b)?136:b;
                    const rgba = `rgba(${safeR},${safeG},${safeB},0.15)`;
                    const applyColor = () => {
                      const el = info.el as HTMLElement;
                      el.style.setProperty("background-color", rgba, "important");
                      el.style.setProperty("opacity", "1", "important");
                      // Also target the inner div FullCalendar creates
                      const inner = el.querySelector(".fc-event-main") as HTMLElement;
                      if(inner) inner.style.setProperty("background-color", rgba, "important");
                    };
                    applyColor();
                    setTimeout(applyColor, 0);
                    setTimeout(applyColor, 50);
                  }
                }}

                eventContent={info=>{
                  if(info.event.display==="background") return null;
                  const isB=Boolean(info.event.extendedProps.isBlock);
                  const color=String(info.event.backgroundColor||"#1a56a0");
                  return (
                    <div className="evc" style={{borderLeft:`3px solid ${color}`}}>
                      <div className="evc-time">{info.timeText}</div>
                      <div className="evc-name">
                        {isB?<><span>⛔</span>{info.event.title||"Blockiert"}</>:String(info.event.extendedProps.patientName??"")}
                      </div>
                      {!isB&&<div className="evc-service">{String(info.event.extendedProps.serviceName??"")}</div>}
                      <div className="evc-therapist">{String(info.event.extendedProps.therapistName??"")}</div>
                    </div>
                  );
                }}
              />
            )}
          </div>
        </section>
      </main>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box}
        html{font-size:13px}
        body{margin:0;background:#eef0f5;font-family:'DM Sans',sans-serif;color:#111827;-webkit-font-smoothing:antialiased}
        .fc{font-family:'DM Sans',sans-serif!important}
        .fc .fc-scrollgrid{border-color:#e5e7eb}
        .fc .fc-col-header-cell{padding:8px 0;background:#fff;border-color:#e5e7eb;font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
        .fc .fc-col-header-cell:hover{background:#f9fafb}
        .fc .fc-timegrid-slot{height:44px;cursor:pointer}
        .fc .fc-timegrid-slot:hover{background:rgba(99,102,241,.03)}
        .fc .fc-timegrid-slot-label{color:#9ca3af;font-size:10px;font-family:'DM Mono',monospace}
        .fc .fc-event{border-radius:0!important;border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important;margin:0 1px!important;cursor:pointer}
        .fc .fc-event:hover .evc{opacity:.88}
        .fc .fc-now-indicator-line{border-color:#ef4444}
        .fc .fc-bg-event{opacity:1!important}
        .fc .fc-bg-event .fc-event-main{background:inherit!important;opacity:1!important}
        .fc .fc-non-business{background:transparent!important}
        .fc .fc-day-today{background:#fff!important}
        .fc .fc-day-today .fc-daygrid-day-frame{background:#fff!important}
        .fc .fc-timegrid-col.fc-day-today{background:#fafafa!important}
        .fc .fc-timegrid-event-harness{margin-right:2px!important}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
        @keyframes fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .spin{animation:spin .8s linear infinite}
      `}</style>
      <style jsx>{`
        .dashboard{display:grid;grid-template-columns:56px 256px minmax(0,1fr);min-height:100vh;background:#eef0f5}
        .icon-rail{display:flex;flex-direction:column;align-items:center;gap:3px;padding:13px 0;background:#0d1b2a}
        .rail-logo{display:grid;place-items:center;width:34px;height:34px;border-radius:8px;background:#e63946;color:#fff;font-size:11px;font-weight:800;margin-bottom:10px}
        .rail-item{display:grid;place-items:center;width:36px;height:36px;border-radius:8px;border:0;background:transparent;color:rgba(255,255,255,.38);cursor:pointer;transition:background .13s,color .13s}
        .rail-item:hover{background:rgba(255,255,255,.08);color:#fff}
        .rail-active{background:rgba(255,255,255,.13)!important;color:#fff!important}
        .rail-spacer{flex:1}
        .rail-signout:hover{background:rgba(239,68,68,.18)!important;color:#fca5a5!important}
        .side-panel{display:flex;flex-direction:column;gap:0;padding:14px 13px;background:#fff;border-right:1px solid #e5e7eb;overflow-y:auto;min-height:0}
        .new-booking{display:flex;align-items:center;gap:7px;width:100%;border:1.5px dashed #d1d5db;border-radius:8px;padding:9px 11px;background:#fff;color:#374151;font-size:12px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;transition:all .13s}
        .new-booking:hover{border-color:#6366f1;background:#f5f3ff;color:#6366f1}
        .mini-cal{margin-top:14px}
        .mini-cal-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:11px;font-weight:700;color:#374151}
        .mini-cal-hdr button{border:0;background:transparent;color:#9ca3af;font-size:15px;cursor:pointer;padding:2px 5px;border-radius:4px;line-height:1}
        .mini-cal-hdr button:hover{background:#f3f4f6;color:#374151}
        .mini-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;text-align:center}
        .wd-row{margin-bottom:3px}
        .wd-row span{font-size:9px;font-weight:700;color:#9ca3af}
        .mday{font-size:10px;color:#374151;padding:4px 1px;border-radius:4px;cursor:pointer;transition:background .1s}
        .mday:hover{background:#f3f4f6}
        .dim{color:#d1d5db}
        .td{background:#e63946!important;color:#fff!important;font-weight:700}
        .divider{height:1px;background:#f3f4f6;margin:12px 0}
        .plabel{display:block;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:5px}
        .plabel-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}
        .plabel-row .plabel{margin-bottom:0}
        .link-btn{border:0;background:transparent;color:#6366f1;font-size:10px;font-weight:600;cursor:pointer;padding:0}
        .link-btn:hover{text-decoration:underline}
        .clinic-chip{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:7px;font-size:11px;color:#374151;font-weight:500}
        .th-list{display:flex;flex-direction:column;gap:1px}
        .th-row{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .1s}
        .th-row:hover{background:#f3f4f6}
        .th-row.chk{background:#f5f3ff}
        .th-row input{display:none}
        .cdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
        .th-name{font-size:11px;font-weight:500;flex:1}
        .legend{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
        .leg-row{display:flex;align-items:center;gap:7px;font-size:10px;color:#6b7280}
        .leg-sw{width:12px;height:12px;border-radius:3px;flex-shrink:0}
        .leg-sw.green{background:rgba(34,197,94,0.3)}
        .leg-sw.orange{background:#ea580c}
        .stat-card{margin-top:auto;padding:12px;background:#0d1b2a;border-radius:9px;color:#fff}
        .stat-lbl{display:block;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.4)}
        .stat-num{display:block;font-size:30px;font-weight:700;line-height:1;margin-top:3px}
        .stat-sub{display:block;font-size:10px;color:rgba(255,255,255,.38);margin-top:2px}
        .p-title{margin:0 0 10px;font-size:15px;font-weight:700}
        .ptitle-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
        .ptitle-row .p-title{margin:0}
        .sbox{display:flex;align-items:center;gap:6px;border:1px solid #e5e7eb;border-radius:7px;padding:0 9px;background:#f9fafb;margin-bottom:8px}
        .sbox-input{flex:1;border:0;background:transparent;padding:8px 0;font-size:11px;font-family:'DM Sans',sans-serif;outline:none}
        .clr{border:0;background:transparent;color:#9ca3af;font-size:15px;cursor:pointer;padding:0}
        .p-count{font-size:10px;color:#9ca3af;margin-bottom:6px}
        .p-list{display:flex;flex-direction:column;gap:5px;overflow-y:auto}
        .p-card{display:flex;align-items:center;gap:8px;padding:8px 9px;border:1px solid #f3f4f6;border-radius:7px;background:#f9fafb}
        .p-avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:800;flex-shrink:0}
        .p-name{font-size:11px;font-weight:600}
        .p-meta{font-size:10px;color:#9ca3af}
        .p-service{color:#059669;font-weight:600}
        .p-count-lbl{color:#6366f1;font-weight:600}
        .empty{font-size:11px;color:#9ca3af;padding:10px 0}
        .tmgmt{display:flex;flex-direction:column;gap:5px}
        .tmgmt-card{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb}
        .tmgmt-info{flex:1;display:flex;flex-direction:column;gap:1px}
        .tmgmt-name{font-size:12px;font-weight:600}
        .tmgmt-sub{font-size:10px;color:#9ca3af}
        .btn-hours{display:flex;align-items:center;gap:4px;border:1px solid #e5e7eb;border-radius:6px;padding:5px 9px;background:#fff;color:#374151;font-size:10px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer}
        .color-picker-wrap{position:relative;cursor:pointer;flex-shrink:0}
        .cdot-large{width:22px!important;height:22px!important;border-radius:6px!important;display:block}
        .color-picker-input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0}
        .btn-hours:hover{background:#f3f4f6}
        .btn-sm-red{border:0;border-radius:6px;padding:6px 11px;background:#e63946;color:#fff;font-size:11px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer}
        .btn-hb{background:#f0fdf4!important;border-color:#bbf7d0!important;font-size:13px!important;padding:5px 8px!important}
        .btn-hb:hover{background:#dcfce7!important}
        .hb-region-block{margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}
        .hb-region-title{padding:8px 12px;background:#f9fafb;font-size:12px;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb}
        /* Stats panel */
        .stats-list{display:flex;flex-direction:column;gap:10px;overflow-y:auto}
        .stats-card{border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f9fafb}
        .stats-header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
        .stats-name{font-size:13px;font-weight:700}
        .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
        .stat-item{display:flex;flex-direction:column;align-items:center;gap:2px;background:#fff;border-radius:7px;padding:8px 4px;border:1px solid #e5e7eb}
        .si-val{font-size:16px;font-weight:700;color:#111827}
        .si-lbl{font-size:9px;color:#9ca3af;text-align:center;font-weight:600;letter-spacing:.04em}
        .occ-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
        .occ-lbl{font-size:10px;color:#6b7280}
        .occ-pct{font-size:11px;font-weight:700}
        .occ-bar{height:6px;background:#e5e7eb;border-radius:99px;overflow:hidden}
        .occ-fill{height:100%;border-radius:99px;transition:width .4s ease}
        .stats-summary{margin-top:14px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
        .ss-row{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;font-size:11px;border-bottom:1px solid #f3f4f6}
        .ss-row:last-child{border-bottom:0}
        .ss-row span{color:#6b7280}
        .ss-row strong{color:#111827;font-weight:700}
        .settings{display:flex;flex-direction:column;gap:8px}
        .s-item{font-size:11px;color:#374151;padding:9px 11px;background:#f9fafb;border-radius:7px}
        .full-w{width:100%;justify-content:center}
        .content{min-width:0;display:flex;flex-direction:column}
        .topbar{display:flex;align-items:center;gap:10px;padding:10px 18px;background:#fff;border-bottom:1px solid #e5e7eb;position:sticky;top:0;z-index:10;flex-wrap:wrap}
        .tnav{display:flex;align-items:center;gap:4px}
        .cal-title{margin:0 0 0 7px;font-size:16px;font-weight:700;color:#111827;white-space:nowrap}
        .nav-btn{border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;background:#fff;color:#374151;font-size:11px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;transition:background .1s}
        .nav-btn:hover{background:#f3f4f6}
        .icn{padding:6px;display:grid;place-items:center}
        .tright{display:flex;align-items:center;gap:7px;margin-left:auto}
        .srch-wrap{position:relative;display:flex;align-items:center}
        .srch-ico{position:absolute;left:8px;color:#9ca3af;pointer-events:none}
        .srch-input{width:170px;border:1px solid #e5e7eb;border-radius:7px;padding:7px 26px 7px 26px;font-size:11px;font-family:'DM Sans',sans-serif;outline:none;background:#f9fafb;transition:border-color .13s,box-shadow .13s}
        .srch-input:focus{border-color:#6366f1;background:#fff;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
        .abs{position:absolute;right:6px}
        .vtabs{display:flex;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
        .vtab{border:0;border-right:1px solid #e5e7eb;padding:6px 11px;background:#fff;color:#6b7280;font-size:11px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;transition:background .1s,color .1s}
        .vtab:last-child{border-right:0}
        .vtab:hover{background:#f3f4f6}
        .vtab.on{background:#0d1b2a;color:#fff}
        .btn-red{border:0;border-radius:7px;padding:7px 13px;background:#e63946;color:#fff;font-size:11px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;white-space:nowrap}
        .btn-red:hover{background:#c1121f}
        .reload-btn{display:grid;place-items:center;width:28px;height:28px;border:1px solid #e5e7eb;border-radius:6px;background:transparent;color:#6b7280;cursor:pointer}
        .reload-btn:hover{background:#f3f4f6}
        .reload-btn:disabled{opacity:.4;cursor:default}
        .res-bar{display:flex;align-items:center;gap:11px;padding:10px 18px;background:#fff;border-bottom:1px solid #e5e7eb}
        .res-avatar{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;font-size:15px;font-weight:800;flex-shrink:0}
        .res-name{margin:0;font-size:15px;font-weight:700}
        .res-sub{font-size:10px;color:#9ca3af}
        .cal-area{flex:1;margin:12px 16px 0;border:1px solid #e5e7eb;border-radius:9px;background:#fff;overflow:hidden}
        .skel{display:flex;flex-direction:column;gap:2px;padding:12px;min-height:320px}
        .skel-row{height:24px;border-radius:4px;background:linear-gradient(90deg,#f3f4f6 25%,#e9eaec 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite}
        .evc{display:flex;flex-direction:column;gap:1px;padding:3px 6px 3px 7px;height:100%;overflow:hidden;background:#fff;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.1);font-size:10px}
        .evc-time{font-family:'DM Mono',monospace;font-size:9px;color:#9ca3af;font-weight:500}
        .evc-name{font-size:11px;font-weight:700;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;display:flex;align-items:center;gap:3px}
        .evc-service{font-size:10px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .evc-therapist{font-size:9px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:auto}
        /* Context menu */
        .ctx-menu{position:fixed;z-index:9990;background:#fff;border:1px solid #e5e7eb;border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.15);min-width:210px;overflow:hidden;animation:fadein .13s ease}
        .ctx-header{padding:7px 12px;font-size:10px;font-weight:700;color:#9ca3af;border-bottom:1px solid #f3f4f6;font-family:'DM Mono',monospace}
        .ctx-item{display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;padding:10px 12px;font-size:12px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;color:#111827;text-align:left;transition:background .1s}
        .ctx-item:hover{background:#f9fafb}
        .ctx-book:hover{color:#1d4ed8}
        .ctx-block:hover{color:#ea580c}
        .ctx-day:hover{color:#7c3aed}
        /* Modals */
        .modal-backdrop{position:fixed;inset:0;background:rgba(13,27,42,.5);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;z-index:9999;animation:fadein .15s ease;overflow-y:auto;padding:24px 16px;-webkit-overflow-scrolling:touch}
        .modal{background:#fff;border-radius:13px;padding:26px 22px;width:340px;max-width:92vw;box-shadow:0 18px 50px rgba(0,0,0,.2);text-align:center;margin:auto 0}
        .modal-wide{width:480px;text-align:left}
        .modal-xl{width:560px;text-align:left}
        .modal.modal-scrollable{max-height:min(90vh,920px);display:flex;flex-direction:column;overflow:hidden;padding:20px 22px 0}
        .modal.modal-scrollable .modal-title{flex-shrink:0;margin-bottom:12px}
        .modal.modal-scrollable .sched-tabs{flex-shrink:0}
        .modal-body-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding-bottom:12px;margin-right:-6px;padding-right:10px}
        .modal-body-scroll::-webkit-scrollbar{width:8px}
        .modal-body-scroll::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}
        .modal-body-scroll::-webkit-scrollbar-thumb:hover{background:#9ca3af}
        .modal.modal-scrollable .modal-actions{flex-shrink:0;margin-top:0;padding:14px 0 18px;border-top:1px solid #e5e7eb;background:#fff}
        .modal-icon{font-size:30px;margin-bottom:8px}
        .modal-title{margin:0 0 16px;font-size:16px;font-weight:700}
        .modal-body{margin:0 0 20px;font-size:12px;color:#374151;line-height:1.6}
        .modal-meta{color:#9ca3af;font-size:10px}
        .modal-actions{display:flex;gap:7px;justify-content:flex-end;margin-top:18px}
        .btn-ghost{border:1.5px solid #e5e7eb;border-radius:7px;padding:8px 16px;background:#fff;color:#374151;font-size:12px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer}
        .btn-ghost:hover{background:#f3f4f6}
        .btn-danger{border:0;border-radius:7px;padding:8px 16px;background:#e63946;color:#fff;font-size:12px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer}
        .btn-danger:disabled{opacity:.5;cursor:default}
        .btn-orange{border:0;border-radius:7px;padding:8px 16px;background:#ea580c;color:#fff;font-size:12px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer}
        .btn-primary-sm{border:0;border-radius:7px;padding:8px 16px;background:#1d4ed8;color:#fff;font-size:12px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer}
        .btn-primary-sm:disabled{opacity:.5;cursor:default}
        .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .form-label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:#374151}
        .form-input{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;font-size:12px;font-family:'DM Sans',sans-serif;outline:none;color:#111827}
        .form-input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
        .form-input:disabled{background:#f9fafb;color:#9ca3af}
        .form-allday{padding:9px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:7px;font-size:12px;font-weight:600;color:#ea580c}
        .time-input{padding:6px 8px;width:100%}
        /* Recurring option */
        .recurring-row{display:flex;align-items:flex-start;gap:10px;margin-top:14px;padding:12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;cursor:pointer}
        .recurring-row input{margin-top:2px;flex-shrink:0}
        .recurring-label{display:block;font-size:12px;font-weight:700;color:#92400e}
        .recurring-sub{display:block;font-size:10px;color:#b45309;margin-top:2px}
        /* Schedule modal tabs */
        .sched-tabs{display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #e5e7eb}
        .sched-tab{flex:1;border:0;background:transparent;padding:10px;font-size:12px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;color:#6b7280;position:relative;transition:color .15s}
        .sched-tab:hover{color:#374151}
        .sched-tab.active{color:#0d1b2a}
        .sched-tab.active::after{content:'';position:absolute;bottom:-2px;left:0;right:0;height:2px;background:#e63946}
        /* Week nav */
        .week-nav{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb}
        .week-btn{border:1px solid #e5e7eb;border-radius:6px;padding:4px 10px;background:#fff;color:#374151;font-size:16px;cursor:pointer;font-weight:700}
        .week-btn:hover{background:#f3f4f6}
        .week-info{flex:1;text-align:center;display:flex;flex-direction:column;gap:2px}
        .week-label{font-size:12px;font-weight:700;color:#111827}
        .week-dates{font-size:10px;color:#9ca3af;font-family:'DM Mono',monospace}
        .hours-hint{margin:0 0 8px;font-size:11px;color:#9ca3af}
        .hours-table{width:100%;border-collapse:collapse;margin:4px 0}
        .hours-table th{font-size:10px;font-weight:700;color:#9ca3af;text-align:left;padding:5px 7px;border-bottom:1px solid #f3f4f6}
        .hours-table td{padding:5px 7px;vertical-align:middle}
        .hours-table tr:hover td{background:#fafafa}
        .day-label{font-size:11px;font-weight:600;color:#374151;min-width:80px}
        .day-date{font-size:10px;color:#9ca3af;font-family:'DM Mono',monospace}
        .row-off .day-label{color:#d1d5db}
        /* Apply all weeks */
        .apply-all-row{display:flex;align-items:flex-start;gap:10px;margin-top:14px;padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;cursor:pointer}
        .apply-all-row input{margin-top:2px;flex-shrink:0}
        .apply-all-label{display:block;font-size:12px;font-weight:700;color:#166534}
        .apply-all-sub{display:block;font-size:10px;color:#15803d;margin-top:2px}
        /* Verfuegbar info */
        .verfueg-info{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:10px;color:#6b7280}
        .vi-dot{width:14px;height:14px;border-radius:3px;flex-shrink:0}
        /* Toasts */
        .toast-stack{position:fixed;bottom:18px;right:18px;display:flex;flex-direction:column;gap:5px;z-index:99999;pointer-events:none}
        .toast{display:flex;align-items:center;gap:9px;padding:10px 13px;border-radius:8px;font-size:11px;font-weight:600;box-shadow:0 5px 18px rgba(0,0,0,.16);animation:fadein .16s ease;pointer-events:all;max-width:300px}
        .toast-success{background:#0d1b2a;color:#d1fae5}
        .toast-error{background:#c1121f;color:#fff}
        .toast-info{background:#1d4ed8;color:#fff}
        .toast-x{border:0;background:transparent;color:inherit;opacity:.7;font-size:15px;cursor:pointer;margin-left:auto}
        @media(max-width:1080px){.dashboard{grid-template-columns:56px minmax(0,1fr)}.side-panel{display:none}}
        /* ── Detail Panel ── */
        .detail-panel{position:fixed;top:0;right:0;height:100vh;width:360px;max-width:92vw;background:#fff;box-shadow:-8px 0 32px rgba(0,0,0,.15);z-index:9998;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1)}
        .detail-panel.open{transform:translateX(0)}
        .dp-overlay{position:fixed;inset:0;z-index:9997;background:rgba(13,27,42,.25);backdrop-filter:blur(1px)}
        .dp-header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 20px 16px;border-bottom:1px solid #f3f4f6}
        .dp-title{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px}
        .dp-name{font-size:16px;font-weight:700;color:#111827;line-height:1.3}
        .dp-close{border:0;background:transparent;font-size:22px;color:#9ca3af;cursor:pointer;line-height:1;padding:4px;border-radius:6px}
        .dp-close:hover{background:#f3f4f6;color:#374151}
        .dp-body{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:8px}
        .dp-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-height:24px}
        .dp-lbl{font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;padding-top:2px}
        .dp-val{font-size:13px;color:#111827;font-weight:500;text-align:right;flex:1}
        .dp-link{font-size:13px;color:#1d4ed8;font-weight:500;text-decoration:none;text-align:right;flex:1}
        .dp-link:hover{text-decoration:underline}
        .dp-divider{height:1px;background:#f3f4f6;margin:6px 0}
        .dp-loading{font-size:12px;color:#9ca3af;text-align:center;padding:12px 0}
        .dp-empty{font-size:12px;color:#9ca3af;text-align:center;padding:12px 0}
        .dp-message{font-size:13px;color:#374151;background:#f9fafb;border-radius:8px;padding:12px;line-height:1.6;margin-top:6px;white-space:pre-wrap}
        .dp-files{display:flex;flex-direction:column;gap:8px;margin-top:6px}
        .dp-file{display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid #e5e7eb;border-radius:9px;background:#f9fafb;color:#1d4ed8;font-size:13px;font-weight:600;text-decoration:none;transition:background .13s}
        .dp-file:hover{background:#eff6ff}
        .dp-footer{padding:16px 20px;border-top:1px solid #f3f4f6}
        .dp-delete-btn{width:100%;border:1.5px solid #fee2e2;border-radius:9px;padding:11px;background:#fff;color:#dc2626;font-size:13px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;transition:background .13s}
        .dp-delete-btn:hover{background:#fef2f2}
        @media(max-width:700px){.dashboard{grid-template-columns:1fr}.icon-rail{display:none}.topbar{padding:9px 11px}.cal-area{margin:9px 9px 0}.srch-input{width:130px}.cal-title{font-size:13px}}
      `}</style>
    </>
  );
}
