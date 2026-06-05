"use client"

import { useEffect, useState, useMemo } from "react"
import { supabase } from "@/lib/supabase"

type Insurance = "gesetzlich" | "privat" | "selbstzahler" | "hausbesuch_peterhausen" | "hausbesuch_allensbach" | "hausbesuch_reichenau"
type SessionType = "morning" | "afternoon"

interface ServiceItem { title: string; subtitle: string; duration: string; price?: string; }
interface TherapistHours { therapist_id: number; day_of_week: number; start_time: string; end_time: string; is_working: boolean; }
interface Verfuegbar { therapist_id: number; day_of_week: number; start_time: string; end_time: string; is_available: boolean; }
interface HausbesuchSetting { therapist_id: number; region: string; day_of_week: number; start_time: string; end_time: string; is_active: boolean; }

function sanitizeText(input: string): string {
  return input.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;").trim()
}
function sanitizeEmail(input: string): string {
  const r=/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/; const t=input.trim(); return r.test(t)?t:""
}
function sanitizePhone(input: string): string { return input.replace(/[^0-9+\-() ]/g,"").trim().slice(0,30) }
function validateName(name: string): boolean { return name.trim().length>0&&name.trim().length<=100&&!/<|>|script/i.test(name) }
const submissionTimestamps: number[] = []
function checkRateLimit(): boolean {
  const now=Date.now(); const recent=submissionTimestamps.filter(t=>now-t<60000)
  submissionTimestamps.length=0; submissionTimestamps.push(...recent)
  if(submissionTimestamps.length>=3) return false
  submissionTimestamps.push(now); return true
}

// ─── TIME SLOTS ──────────────────────────────────────────────
const generateBaseSlots=()=>{ const s:string[]=[]; for(let h=7;h<21;h++) for(let m=0;m<60;m+=20){ const st=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; const eh=m+20>=60?h+1:h; const em=(m+20)%60; s.push(`${st} - ${String(eh).padStart(2,"0")}:${String(em).padStart(2,"0")}`); } return s; }
const BASE_SLOTS=generateBaseSlots()
const HAUSBESUCH_SLOTS=(()=>{ const s:string[]=[]; for(let h=7;h<21;h++) s.push(`${String(h).padStart(2,"0")}:00 - ${String(h+1).padStart(2,"0")}:00`); return s; })()

function parseDuration(d:string):number{ if(d.includes("Std"))return 60; const m=d.match(/(\d+)/); return m?parseInt(m[1]):20 }
function getRequiredSlots(d:string,isHB:boolean):number{ return isHB?1:Math.ceil(parseDuration(d)/20) }
function getSlotIndex(slot:string,isHB:boolean):number{ const st=slot.split(" - ")[0]; return (isHB?HAUSBESUCH_SLOTS:BASE_SLOTS).findIndex(s=>s.startsWith(st)) }
function timeToMinutes(t:string):number{ const m=String(t).match(/^(\d{2}):(\d{2})/); if(!m)return 0; return parseInt(m[1])*60+parseInt(m[2]) }
function insuranceToHbRegion(insurance: string): string | null {
  if (insurance === "hausbesuch_peterhausen") return "peterhausen"
  if (insurance === "hausbesuch_allensbach") return "allensbach"
  if (insurance === "hausbesuch_reichenau") return "reichenau"
  return null
}

function isSlotInWorkingHours(slot:string,req:number,tid:number,date:string,verfuegbar:Verfuegbar[],hours:TherapistHours[],isHB:boolean,hbSettings:HausbesuchSetting[],hbRegion:string|null):boolean{
  if(!date)return true
  const slots=isHB?HAUSBESUCH_SLOTS:BASE_SLOTS
  const dow=new Date(date+"T12:00:00").getDay()
  const idx=getSlotIndex(slot,isHB); if(idx===-1||idx+req>slots.length)return false
  const ss=timeToMinutes(slots[idx].split(" - ")[0]); const se=timeToMinutes(slots[idx+req-1].split(" - ")[1])
  if(isHB&&hbRegion){
    const hbRows=hbSettings.filter(h=>h.therapist_id===tid&&h.region===hbRegion&&h.day_of_week===dow&&h.is_active)
    if(hbRows.length===0)return false
    return hbRows.some(h=>ss>=timeToMinutes(h.start_time)&&se<=timeToMinutes(h.end_time))
  }
  const vRows=verfuegbar.filter(v=>v.therapist_id===tid&&v.day_of_week===dow&&v.is_available)
  if(vRows.length>0) return vRows.some(v=>ss>=timeToMinutes(v.start_time)&&se<=timeToMinutes(v.end_time))
  const h=hours.find(x=>x.therapist_id===tid&&x.day_of_week===dow)
  if(!h||!h.is_working)return false
  return ss>=timeToMinutes(h.start_time)&&se<=timeToMinutes(h.end_time)
}
function isSlotBlocked(slot:string,req:number,tid:number,date:string,blocks:any[],isHB:boolean):boolean{
  if(!date)return false
  const slots=isHB?HAUSBESUCH_SLOTS:BASE_SLOTS; const idx=getSlotIndex(slot,isHB); if(idx===-1)return false
  const needed=slots.slice(idx,idx+req)
  return blocks.some(b=>{ if(b.therapist_id!==tid||b.date!==date)return false; const bs=timeToMinutes(b.start_time); const be=timeToMinutes(b.end_time); return needed.some(ns=>{ const nss=timeToMinutes(ns.split(" - ")[0]); const nse=timeToMinutes(ns.split(" - ")[1]); return nss<be&&nse>bs }) })
}
type TimeRange={start:number;end:number}
type BookedEntry={therapist_id:number|null;date?:string;time:string}
function parseTimeRange(timeStr:string):TimeRange|null{
  const parts=String(timeStr).split(" - ").map(p=>p.trim())
  if(parts.length<2)return null
  const start=timeToMinutes(parts[0]); const end=timeToMinutes(parts[1])
  if(end<=start)return null
  return {start,end}
}
function getSlotTimeRange(slot:string,req:number,isHB:boolean):TimeRange|null{
  const slots=isHB?HAUSBESUCH_SLOTS:BASE_SLOTS
  const idx=getSlotIndex(slot,isHB)
  if(idx===-1||idx+req>slots.length)return null
  return {
    start:timeToMinutes(slots[idx].split(" - ")[0]),
    end:timeToMinutes(slots[idx+req-1].split(" - ")[1]),
  }
}
function timeRangesOverlap(a:TimeRange,b:TimeRange):boolean{
  return a.start<b.end&&b.start<a.end
}
function sameTherapist(a:number|null|undefined,b:number|null|undefined):boolean{
  if(a==null||b==null)return false
  return Number(a)===Number(b)
}
function hasConflict(slot:string,req:number,tid:number,booked:BookedEntry[],date:string,isHB:boolean):boolean{
  const needed=getSlotTimeRange(slot,req,isHB)
  if(!needed)return true
  return booked.some(b=>{
    if(!sameTherapist(b.therapist_id,tid))return false
    if(b.date&&b.date!==date)return false
    const existing=parseTimeRange(b.time)
    if(!existing)return false
    return timeRangesOverlap(needed,existing)
  })
}
function hasTimeConflict(tid:number,date:string,timeStr:string,booked:BookedEntry[]):boolean{
  const needed=parseTimeRange(timeStr)
  if(!needed)return true
  return booked.some(b=>{
    if(!sameTherapist(b.therapist_id,tid))return false
    if(b.date&&b.date!==date)return false
    const existing=parseTimeRange(b.time)
    if(!existing)return false
    return timeRangesOverlap(needed,existing)
  })
}
function getSlotsForDuration(d:string,isHB:boolean):string[]{
  if(isHB)return HAUSBESUCH_SLOTS; const sc=Math.ceil(parseDuration(d)/20); if(sc===1)return BASE_SLOTS
  const c:string[]=[]; for(let i=0;i<=BASE_SLOTS.length-sc;i++) c.push(`${BASE_SLOTS[i].split(" - ")[0]} - ${BASE_SLOTS[i+sc-1].split(" - ")[1]}`); return c
}
function getMorningSlots(d:string,isHB:boolean):string[]{ return getSlotsForDuration(d,isHB).filter(s=>parseInt(s.split(":")[0])>=7&&parseInt(s.split(":")[0])<12) }
function getAfternoonSlots(d:string,isHB:boolean):string[]{ return getSlotsForDuration(d,isHB).filter(s=>parseInt(s.split(":")[0])>=12&&parseInt(s.split(":")[0])<21) }
function isSlotAvailable(slot:string,req:number,tid:number|null,booked:BookedEntry[],therapists:any[],verfuegbar:Verfuegbar[],hours:TherapistHours[],blocks:any[],date:string,isHB:boolean,hbSettings:HausbesuchSetting[],hbRegion:string|null):boolean{
  const slots=isHB?HAUSBESUCH_SLOTS:BASE_SLOTS; const idx=getSlotIndex(slot,isHB); if(idx===-1||idx+req>slots.length)return false
  if(tid!==null)return isSlotInWorkingHours(slot,req,tid,date,verfuegbar,hours,isHB,hbSettings,hbRegion)&&!isSlotBlocked(slot,req,tid,date,blocks,isHB)&&!hasConflict(slot,req,tid,booked,date,isHB)
  return therapists.some(t=>isSlotInWorkingHours(slot,req,t.id,date,verfuegbar,hours,isHB,hbSettings,hbRegion)&&!isSlotBlocked(slot,req,t.id,date,blocks,isHB)&&!hasConflict(slot,req,t.id,booked,date,isHB))
}
function getAvailableTherapists(slot:string,req:number,booked:BookedEntry[],therapists:any[],verfuegbar:Verfuegbar[],hours:TherapistHours[],blocks:any[],date:string,isHB:boolean,hbSettings:HausbesuchSetting[],hbRegion:string|null):any[]{
  const slots=isHB?HAUSBESUCH_SLOTS:BASE_SLOTS; const idx=getSlotIndex(slot,isHB); if(idx===-1||idx+req>slots.length)return[]
  return therapists.filter(t=>isSlotInWorkingHours(slot,req,t.id,date,verfuegbar,hours,isHB,hbSettings,hbRegion)&&!isSlotBlocked(slot,req,t.id,date,blocks,isHB)&&!hasConflict(slot,req,t.id,booked,date,isHB))
}
function getDisplaySlot(slot:string,req:number,isHB:boolean):string{
  const slots=isHB?HAUSBESUCH_SLOTS:BASE_SLOTS; const idx=getSlotIndex(slot,isHB); const end=slots[idx+req-1]
  return `${slot.split(" - ")[0]} - ${end?end.split(" - ")[1]:slot.split(" - ")[1]}`
}

// ─── Services ────────────────────────────────────────────────
const gesetzlicheServices:ServiceItem[]=[
  {title:"Krankengymnastik/Manuelle Therapie Doppeltermin",subtitle:"(KG oder MT Doppeltermin auf Rezept)",duration:"40 Min."},
  {title:"Krankengymnastik/Manuelle Therapie",subtitle:"(KG/MT auf Rezept)",duration:"20 Min."},
  {title:"KG-ZNS PNF",subtitle:"(Krankengymnastik mit PNF)",duration:"40 Min."},
  {title:"KG-Atemtherapie + KMT",subtitle:"(KG-AT + Klassische Massagetherapie)",duration:"40 Min."},
  {title:"KG-ZNS Erwachsene Bobath",subtitle:"(Krankengymnastik für Erwachsene)",duration:"40 Min."},
  {title:"Krankengymnastik Doppel PLUS",subtitle:"(KG einfach + privater Anteil)",duration:"40 Min.",price:"40,00 €"},
  {title:"Manuelle Lymphdrainage 60",subtitle:"(MLD 60 auf Rezept)",duration:"1 Std."},
  {title:"Manuelle Lymphdrainage 45",subtitle:"(MLD 45 auf Rezept)",duration:"40 Min."},
  {title:"Manuelle Lymphdrainage 30",subtitle:"(MLD 30 auf Rezept)",duration:"20 Min."},
  {title:"KMT auf Rezept",subtitle:"(Klassische Massagetherapie)",duration:"20 Min."},
]
const selbstzahlerServices:ServiceItem[]=[{title:"Fußreflexzonen Massage",subtitle:"Fußmassage auf Basis der Fußreflexzonen",duration:"40 Min.",price:"55,00 €"}]
const privateServices:ServiceItem[]=[
  {title:"Krankengymnastik P",subtitle:"(KG auf Rezept Privat)",duration:"20 Min."},
  {title:"Manuelle Therapie P",subtitle:"(MT auf Rezept Privat)",duration:"20 Min."},
  {title:"Krankengymnastik/Manuelle Therapie Doppeltermin P",subtitle:"(KG/MT Doppeltermin Privat)",duration:"40 Min."},
  {title:"KG-ZNS PNF P",subtitle:"(Krankengymnastik mit PNF)",duration:"40 Min."},
  {title:"KG-ZNS Erwachsene Bobath P",subtitle:"(Bobath Konzept)",duration:"40 Min."},
  {title:"KG ATG + KMT P",subtitle:"(Atemtherapie + Massage)",duration:"40 Min."},
  {title:"Manuelle Lymphdrainage 45 P",subtitle:"(MLD 45 Privat)",duration:"40 Min."},
  {title:"Manuelle Lymphdrainage 60 P",subtitle:"(MLD 60 Privat)",duration:"1 Std."},
  {title:"Manuelle Lymphdrainage 30 P",subtitle:"(MLD 30 privat)",duration:"40 Min."},
  {title:"Klassische Massagetherapie P",subtitle:"(KMT Privat)",duration:"20 Min."},
]
const hausbesuchServices:ServiceItem[]=[...gesetzlicheServices,...selbstzahlerServices,...privateServices].filter(s=>{const d=parseDuration(s.duration);return d===40||d===60})
const ALL_VALID_SERVICES=[...gesetzlicheServices,...selbstzahlerServices,...privateServices,...hausbesuchServices]
const VALID_INSURANCE:Insurance[]=["gesetzlich","privat","selbstzahler","hausbesuch_peterhausen","hausbesuch_allensbach","hausbesuch_reichenau"]
const HAUSBESUCH_LOCATIONS:{id:Insurance;label:string;sub:string}[]=[
  {id:"hausbesuch_peterhausen",label:"Peterhausen Hausbesuch",sub:"Konstanz-Peterhausen"},
  {id:"hausbesuch_allensbach",label:"Allensbach Hausbesuch",sub:"Allensbach"},
  {id:"hausbesuch_reichenau",label:"Reichenau Hausbesuch",sub:"Insel Reichenau"},
]
const PRIVACY_URL="https://www.physiotherapie-rieckmann.de/datenschutz"
const MONTHS=["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"]
const WEEKDAYS=["MO","DI","MI","DO","FR","SA","SO"]

export default function BookPage() {
  const [step, setStep] = useState(1)
  const [insurance, setInsurance] = useState<Insurance|"">("")
  const [service, setService] = useState<ServiceItem|null>(null)
  const [therapistId, setTherapistId] = useState<number|null>(null)
  const [therapists, setTherapists] = useState<any[]>([])
  const [therapistHours, setTherapistHours] = useState<TherapistHours[]>([])
  const [verfuegbar, setVerfuegbar] = useState<Verfuegbar[]>([])
  const [hausbesuchSettings, setHausbesuchSettings] = useState<HausbesuchSetting[]>([])
  const [blocks, setBlocks] = useState<any[]>([])
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [activeDate, setActiveDate] = useState("")
  const [appointments, setAppointments] = useState<Array<{date:string;time:string;therapistId:number|null}>>([])
  const [sessionType, setSessionType] = useState<SessionType|null>(null)
  const [time, setTime] = useState("")
  const [booked, setBooked] = useState<any[]>([])
  // Step 5 fields
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [message, setMessage] = useState("")
  const [dsgvo, setDsgvo] = useState(false)
  const [prescriptionFiles, setPrescriptionFiles] = useState<File[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState("")
  const [showHausbesuchLocations, setShowHausbesuchLocations] = useState(false)

  const isHausbesuch = insurance.startsWith("hausbesuch")
  const hbRegion = insuranceToHbRegion(insurance)

  const therapistsForBooking = useMemo(()=>{
    if(!isHausbesuch||!hbRegion)return therapists
    const ids=new Set(hausbesuchSettings.filter(h=>h.region===hbRegion&&h.is_active).map(h=>h.therapist_id))
    return therapists.filter(t=>ids.has(t.id))
  },[therapists,hausbesuchSettings,isHausbesuch,hbRegion])

  useEffect(()=>{
    supabase.from("therapists").select("*").eq("active",true).then(({data})=>setTherapists(data||[]))
    supabase.from("therapist_hours").select("therapist_id,day_of_week,start_time,end_time,is_working").then(({data})=>setTherapistHours((data||[]) as TherapistHours[]))
    supabase.from("verfuegbarzeiten").select("therapist_id,day_of_week,start_time,end_time,is_available").then(({data})=>setVerfuegbar((data||[]) as Verfuegbar[]))
    supabase.from("hausbesuch_settings").select("therapist_id,region,day_of_week,start_time,end_time,is_active").eq("is_active",true)
      .then(({data,error})=>{ if(!error) setHausbesuchSettings((data??[]) as HausbesuchSetting[]) })
  },[])

  useEffect(()=>{
    if(therapistId!==null&&!therapistsForBooking.some(t=>t.id===therapistId)) setTherapistId(null)
  },[therapistId,therapistsForBooking])

  const fetchBooked=async(date:string)=>{ if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return; const{data}=await supabase.from("appointments").select("*").eq("date",date); setBooked(data||[]) }
  const fetchBlocksForDate=async(date:string)=>{ if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return; const{data}=await supabase.from("blocks").select("*").eq("date",date); setBlocks(p=>[...p.filter(b=>b.date!==date),...(data||[])]) }

  const calendarDays=useMemo(()=>{
    const y=currentMonth.getFullYear(); const mo=currentMonth.getMonth()
    const fd=new Date(y,mo,1); const ld=new Date(y,mo+1,0)
    const so=(fd.getDay()+6)%7; const d:(number|null)[]=Array(so).fill(null)
    for(let i=1;i<=ld.getDate();i++)d.push(i); return d
  },[currentMonth])

  const today=new Date()
  const todayStr=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`
  const makeDateStr=(day:number)=>`${currentMonth.getFullYear()}-${String(currentMonth.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`
  const isPast=(day:number)=>makeDateStr(day)<todayStr
  const isWorkingDay=(day:number):boolean=>{
    const ds=makeDateStr(day); const dow=new Date(ds+"T12:00:00").getDay()
    if(isHausbesuch&&hbRegion){
      const dayHb=hausbesuchSettings.filter(h=>h.region===hbRegion&&h.day_of_week===dow&&h.is_active)
      if(therapistId!==null) return dayHb.some(h=>h.therapist_id===therapistId)
      const bookableIds=new Set(therapistsForBooking.map(t=>t.id))
      return dayHb.some(h=>bookableIds.has(h.therapist_id))
    }
    if(therapistId!==null){ const vR=verfuegbar.filter(v=>v.therapist_id===therapistId&&v.day_of_week===dow&&v.is_available); if(vR.length>0)return true; const h=therapistHours.find(x=>x.therapist_id===therapistId&&x.day_of_week===dow); return!!(h&&h.is_working) }
    return verfuegbar.some(v=>v.day_of_week===dow&&v.is_available)||therapistHours.some(h=>h.day_of_week===dow&&h.is_working)
  }

  const handleDateSelect=(day:number)=>{
    const d=makeDateStr(day)
    if(selectedDates.includes(d)){ setSelectedDates(p=>p.filter(x=>x!==d)); setAppointments(p=>p.filter(a=>a.date!==d)); if(activeDate===d){const r=selectedDates.filter(x=>x!==d);setActiveDate(r.length>0?r[0]:"");if(r.length>0)fetchBooked(r[0])} return }
    if(selectedDates.length>=10){setStatusMsg("❌ Maximal 10 Termine pro Buchung.");return}
    setSelectedDates(p=>[...p,d]); setActiveDate(d); setSessionType("morning"); setTime(""); fetchBooked(d); fetchBlocksForDate(d)
  }

  const req=service?getRequiredSlots(service.duration,isHausbesuch):1
  const rawSlots=sessionType==="morning"?getMorningSlots(service?.duration||"20 Min.",isHausbesuch):sessionType==="afternoon"?getAfternoonSlots(service?.duration||"20 Min.",isHausbesuch):[]
  const mergedBooked=useMemo(():BookedEntry[]=>{
    const pending=appointments
      .filter(a=>a.therapistId!=null)
      .map(a=>({therapist_id:a.therapistId,date:a.date,time:getDisplaySlot(a.time,req,isHausbesuch)}))
    return [...booked.map(b=>({therapist_id:b.therapist_id,date:b.date,time:b.time})),...pending]
  },[booked,appointments,req,isHausbesuch])
  const bookedForActiveDate=useMemo(
    ()=>activeDate?mergedBooked.filter(b=>!b.date||b.date===activeDate):mergedBooked,
    [mergedBooked,activeDate],
  )
  const activeSlots=rawSlots.filter(slot=>isSlotAvailable(slot,req,therapistId,bookedForActiveDate,therapistsForBooking,verfuegbar,therapistHours,blocks,activeDate,isHausbesuch,hausbesuchSettings,hbRegion))

  // Upload prescription files to Supabase Storage
  const uploadPrescriptions=async():Promise<string[]>=>{
    const urls:string[]=[]
    for(const file of prescriptionFiles){
      const fileName=`${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`
      const{data,error}=await supabase.storage.from("prescriptions").upload(fileName,file,{cacheControl:"3600",upsert:false})
      if(error){console.error("Upload error:",error);continue}
      const{data:urlData}=supabase.storage.from("prescriptions").getPublicUrl(fileName)
      if(urlData?.publicUrl) urls.push(urlData.publicUrl)
    }
    return urls
  }

  const sendEmail=async(aptData:any[])=>{
    try{
      const html=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;border-radius:16px 16px 0 0;text-align:center;"><h1 style="color:white;margin:0;">📅 Terminbestätigung</h1></div>
        <div style="padding:30px;background:white;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 16px 16px;">
          <p>Hallo <strong>${sanitizeText(name)}</strong>,</p><p>Ihr Termin wurde gebucht:</p>
          ${aptData.map(apt=>`<div style="margin-bottom:12px;padding:12px;background:#f8f9fa;border-radius:8px;border-left:4px solid #667eea;">
            <p style="margin:0 0 4px"><strong>Datum:</strong> ${new Date(apt.date).toLocaleDateString("de-DE")}</p>
            <p style="margin:0 0 4px"><strong>Uhrzeit:</strong> ${sanitizeText(apt.time)}</p>
            <p style="margin:0 0 4px"><strong>Behandlung:</strong> ${sanitizeText(service?.title||"")}</p>
            <p style="margin:0"><strong>Therapeut:</strong> ${sanitizeText(apt.therapistName||"Egal")}</p>
          </div>`).join("")}
          ${message?`<p><strong>Ihre Nachricht:</strong> ${sanitizeText(message)}</p>`:""}
          <p style="color:#666;font-size:14px;">Bei Fragen kontaktieren Sie uns bitte.</p>
        </div></div>`
      const r=await fetch("https://eomnullgoxpixcbniqez.supabase.co/functions/v1/send-email",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""}`},body:JSON.stringify({to:email,subject:"Terminbestätigung - Ihre Praxis",html})})
      return r.ok
    }catch{return false}
  }

  const handleSubmit=async(e:React.FormEvent)=>{
    e.preventDefault()
    if(!checkRateLimit()){setStatusMsg("❌ Zu viele Versuche. Bitte warten.");return}
    if(!name?.trim()||!validateName(name)){setStatusMsg("❌ Bitte gültigen Namen eingeben");return}
    const validEmail=sanitizeEmail(email); if(!validEmail){setStatusMsg("❌ Bitte gültige E-Mail eingeben");return}
    if(!phone?.trim()){setStatusMsg("❌ Bitte Telefonnummer eingeben");return}
    if(!dsgvo){setStatusMsg("❌ Bitte Datenschutzerklärung akzeptieren");return}
    if(selectedDates.length===0){setStatusMsg("❌ Bitte mindestens ein Datum wählen");return}
    if(!time){setStatusMsg("❌ Bitte Uhrzeit wählen");return}
    const validService=ALL_VALID_SERVICES.find(s=>s.title===service?.title); if(!validService){setStatusMsg("❌ Ungültige Behandlung");return}
    if(!VALID_INSURANCE.includes(insurance as Insurance)){setStatusMsg("❌ Ungültige Versicherungsart");return}
    setLoading(true); setStatusMsg("⏳ Termin wird gespeichert…")

    // 1. Upload prescriptions
    let prescriptionUrls:string[]=[]
    if(prescriptionFiles.length>0){
      setUploadingFiles(true); setStatusMsg("⏳ Dokumente werden hochgeladen…")
      prescriptionUrls=await uploadPrescriptions(); setUploadingFiles(false)
    }

    // 2. Insert appointments — use exact column names from DB
    const safePhone = sanitizePhone(phone)
    const baseCols = {
      name:             sanitizeText(name.trim()),
      email:            validEmail,
      phone:            safePhone,
      service:          validService.title,
      insurance:        insurance as string,
      message:          message ? sanitizeText(message) : null,
      privacy_accepted: dsgvo,
      prescription_files: prescriptionUrls.length > 0 ? prescriptionUrls : null,
    }
    const insertData = appointments.length > 0
      ? appointments.map(apt => ({
          ...baseCols,
          date: apt.date,
          time: getDisplaySlot(apt.time,req,isHausbesuch),
          ...(apt.therapistId !== null ? { therapist_id: apt.therapistId } : { therapist_id: null }),
        }))
      : [{
          ...baseCols,
          date: activeDate,
          time: getDisplaySlot(time,req,isHausbesuch),
          therapist_id: therapistId,
        }]

    const datedApts=insertData.filter(a=>a.therapist_id!=null)
    if(datedApts.length>0){
      const dates=[...new Set(datedApts.map(a=>a.date))]
      const existing:BookedEntry[]=[]
      for(const d of dates){
        const{data}=await supabase.from("appointments").select("therapist_id,date,time").eq("date",d)
        existing.push(...((data??[]) as BookedEntry[]))
      }
      const seen:BookedEntry[]=[...existing]
      for(const apt of datedApts){
        const tid=Number(apt.therapist_id)
        if(hasTimeConflict(tid,apt.date,apt.time,seen)){
          setLoading(false)
          setStatusMsg("❌ Terminkonflikt: Der Therapeut ist zu dieser Zeit bereits gebucht.")
          return
        }
        seen.push({therapist_id:tid,date:apt.date,time:apt.time})
      }
    }

    let insertedIds: string[] = []
    try {
      const { data, error } = await supabase
        .from("appointments")
        .insert(insertData)
        .select("id")
      if (error) { setLoading(false); setStatusMsg(`❌ Fehler: ${error.message}`); console.error("Insert error:", error); return }
      insertedIds = (data || []).map((r: any) => String(r.id))
    } catch(err) { setLoading(false); setStatusMsg("❌ Netzwerkfehler."); console.error(err); return }

    // 3. Insert appointment_details (extended info)
    for (const aptId of insertedIds) {
      const { error: detErr } = await supabase.from("appointment_details").insert({
        appointment_id: aptId,
        patient_name:   sanitizeText(name.trim()),
        patient_email:  validEmail,
        patient_phone:  safePhone,
        message:        message ? sanitizeText(message) : null,
        dsgvo_accepted: dsgvo,
        prescription_urls: prescriptionUrls.length > 0 ? prescriptionUrls : null,
      })
      if (detErr) console.warn("appointment_details insert error:", detErr)
    }

    setStatusMsg("📧 E-Mail wird gesendet…")
    const aptWithNames=insertData.map(apt=>({...apt,therapistName:(apt as any).therapist_id?therapists.find(t=>t.id===(apt as any).therapist_id)?.name||"Egal":"Egal"}))
    const ok=await sendEmail(aptWithNames)
    setLoading(false)
    setStatusMsg(ok?`✅ ${insertData.length} Termin(e) gebucht! Bestätigung gesendet.`:`✅ ${insertData.length} Termin(e) gebucht! ⚠️ E-Mail konnte nicht gesendet werden.`)
    // Reset
    setStep(1);setInsurance("");setService(null);setName("");setEmail("");setPhone("");setMessage("");setDsgvo(false);setPrescriptionFiles([])
    setActiveDate("");setSelectedDates([]);setAppointments([]);setTime("");setSessionType(null);setTherapistId(null);setCurrentMonth(new Date());setShowHausbesuchLocations(false)
  }

  const progress=((step-1)/4)*100
  const getServices=()=>{
    if(isHausbesuch)return hausbesuchServices
    if(insurance==="gesetzlich")return gesetzlicheServices
    if(insurance==="privat")return privateServices
    if(insurance==="selbstzahler")return selbstzahlerServices
    return[]
  }

  return (
    <div className="book-wrapper">
      <div className="book-card">
        <div className="book-header">
          <div className="book-icon">📅</div>
          <h1>Termin buchen</h1>
          <p>Schritt {step} von 5</p>
        </div>
        <div className="progress-track"><div className="progress-fill" style={{width:`${progress}%`}}/></div>
        <div className="book-content">
          {statusMsg&&<div className={`message-box ${statusMsg.includes("✅")?"success":statusMsg.includes("❌")?"error":"info"}`}>{statusMsg}</div>}

          {/* STEP 1 — Versicherung / Hausbesuch */}
          {step===1&&<div className="fade-in-up">
            <StepBadge num={1} text={showHausbesuchLocations?"Standort wählen":"Versicherung wählen"}/>
            <div className="option-list">
              {!showHausbesuchLocations?(
                <>
                  {([
                    {id:"gesetzlich" as Insurance,label:"Gesetzliche Krankenkasse",icon:"🏥"},
                    {id:"privat" as Insurance,label:"Private Krankenversicherung",icon:"💎"},
                    {id:"selbstzahler" as Insurance,label:"Selbstzahler",icon:"💳"},
                  ]).map(item=>(
                    <button key={item.id} type="button" onClick={()=>{setInsurance(item.id);setStep(2)}} className={`option-card ${insurance===item.id?"selected":""}`}>
                      <span className="option-icon">{item.icon}</span>
                      <span className="option-label">{item.label}</span>
                      {insurance===item.id&&<span className="option-check">✓</span>}
                    </button>
                  ))}
                  <button type="button" onClick={()=>setShowHausbesuchLocations(true)} className="option-card">
                    <span className="option-icon">🏠</span>
                    <span className="option-label">Hausbesuch</span>
                  </button>
                </>
              ):(
                <>
                  <BackButton onClick={()=>setShowHausbesuchLocations(false)}/>
                  {HAUSBESUCH_LOCATIONS.map(item=>(
                    <button key={item.id} type="button" onClick={()=>{setInsurance(item.id);setStep(2)}} className={`option-card hb-card ${insurance===item.id?"selected":""}`}>
                      <span className="option-icon">📍</span>
                      <div style={{flex:1,textAlign:"left"}}>
                        <div className="option-label">{item.label}</div>
                        <div className="option-sub">{item.sub}</div>
                      </div>
                      {insurance===item.id&&<span className="option-check">✓</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>}

          {/* STEP 2 — Behandlung */}
          {step===2&&<div className="fade-in-up">
            <BackButton onClick={()=>{setStep(1);setShowHausbesuchLocations(isHausbesuch)}}/>
            <StepBadge num={2} text="Behandlung wählen"/>
            <div className="service-list">{getServices().map((s,i)=><ServiceCard key={i} service={s} isSelected={service?.title===s.title} onClick={()=>{setService(s);setStep(3)}}/>)}</div>
          </div>}

          {/* STEP 3 — Therapeut */}
          {step===3&&<div className="fade-in-up">
            <BackButton onClick={()=>setStep(2)}/>
            <StepBadge num={3} text="Therapeut wählen"/>
            {isHausbesuch&&therapistsForBooking.length===0?(
              <div className="message-box error">Für diesen Hausbesuch-Standort ist aktuell kein Therapeut hinterlegt. Bitte kontaktieren Sie die Praxis.</div>
            ):(
            <div className="therapist-grid">
              {(!isHausbesuch||therapistsForBooking.length>1)&&(
                <TherapistCard name="Egal" isSelected={therapistId===null} onClick={()=>{setTherapistId(null);setStep(4)}}/>
              )}
              {therapistsForBooking.map(t=><TherapistCard key={t.id} name={t.name} isSelected={therapistId===t.id} onClick={()=>{setTherapistId(t.id);setStep(4)}}/>)}
            </div>
            )}
          </div>}

          {/* STEP 4 — Termin auswählen */}
          {step===4&&<div className="fade-in-up">
            <BackButton onClick={()=>setStep(3)}/>
            <StepBadge num={4} text="Termin auswählen"/>
            <div className="summary-box">
              <h3>Ihre Auswahl</h3>
              <div className="summary-grid">
                <div><span>Versicherung:</span> <strong>{
                  insurance==="hausbesuch_peterhausen"?"🏠 Peterhausen Hausbesuch":
                  insurance==="hausbesuch_allensbach"?"🏠 Allensbach Hausbesuch":
                  insurance==="hausbesuch_reichenau"?"🏠 Reichenau Hausbesuch":
                  insurance
                }</strong></div>
                <div><span>Behandlung:</span> <strong>{service?.title}</strong> <span style={{opacity:.6,fontSize:"12px"}}>({service?.duration})</span></div>
                <div><span>Therapeut:</span> <strong>{therapistId!==null?therapistsForBooking.find(t=>t.id===therapistId)?.name||therapists.find(t=>t.id===therapistId)?.name||"Egal":"Egal"}</strong></div>
              </div>
            </div>

            {selectedDates.length>0&&<div style={{marginBottom:"20px",display:"flex",flexWrap:"wrap",gap:"8px"}}>
              {selectedDates.map(d=>{
                const apt=appointments.find(a=>a.date===d)
                return <button key={d} onClick={()=>{setActiveDate(d);setSessionType("morning");setTime("");fetchBooked(d);fetchBlocksForDate(d)}} className={`date-chip ${activeDate===d?"active":""}`}>
                  <div>{new Date(d).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})}</div>
                  {apt&&<div className="chip-time">{getDisplaySlot(apt.time,req,isHausbesuch)}</div>}
                  <span className="chip-remove" onClick={e=>{e.stopPropagation();setSelectedDates(p=>p.filter(x=>x!==d));setAppointments(p=>p.filter(a=>a.date!==d));if(activeDate===d){const r=selectedDates.filter(x=>x!==d);setActiveDate(r.length>0?r[0]:"");setTime("")}}}>×</span>
                </button>
              })}
            </div>}

            <div className="calendar-time-split">
              <div className="calendar-panel">
                <div className="calendar-nav">
                  <button onClick={()=>setCurrentMonth(new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1))} className="nav-arrow">‹</button>
                  <div className="calendar-title"><div className="month-name">{MONTHS[currentMonth.getMonth()]}</div><div className="year-name">{currentMonth.getFullYear()}</div></div>
                  <button onClick={()=>setCurrentMonth(new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1))} className="nav-arrow">›</button>
                </div>
                <div className="weekday-row">{WEEKDAYS.map(d=><div key={d} className="weekday-cell">{d}</div>)}</div>
                <div className="days-grid">
                  {calendarDays.map((day,i)=>{
                    const nw=day!==null&&!isPast(day)&&!isWorkingDay(day)
                    return <button key={i} disabled={day===null||isPast(day)||nw} onClick={()=>day!==null&&handleDateSelect(day)}
                      className={`day-cell ${day===null?"empty":""} ${day!==null&&isPast(day)?"past":""} ${day!==null&&makeDateStr(day)===todayStr?"today":""} ${day!==null&&selectedDates.includes(makeDateStr(day))?"selected":""} ${day!==null&&makeDateStr(day)===activeDate?"active":""} ${nw?"no-work":""}`}>
                      {day}
                    </button>
                  })}
                </div>
                <div className="timezone">Zeitzone: (UTC+01:00) Brüssel, Kopenhagen, Madrid, Paris</div>
              </div>
              <div className="time-panel">
                {!activeDate&&<div className="select-session-hint">Bitte zuerst ein Datum wählen</div>}
                {activeDate&&<>
                  <div className="session-tabs">
                    <button onClick={()=>{setSessionType("morning");setTime("")}} className={`session-tab ${sessionType==="morning"?"active":""}`}>Vormittag</button>
                    <button onClick={()=>{setSessionType("afternoon");setTime("")}} className={`session-tab ${sessionType==="afternoon"?"active":""}`}>Nachmittag</button>
                  </div>
                  {sessionType&&<>
                    {activeSlots.length===0&&<div className="no-slots">Keine verfügbaren Zeiten.<br/><span style={{fontSize:"12px",opacity:.7}}>Anderen Tag oder Therapeuten wählen.</span></div>}
                    <div className="time-slots-grid">
                      {therapistId===null
                        ?activeSlots.flatMap(slot=>{ const avail=getAvailableTherapists(slot,req,booked,therapistsForBooking,verfuegbar,therapistHours,blocks,activeDate,isHausbesuch,hausbesuchSettings,hbRegion); return avail.map(t=>(
                            <button key={`${slot}__${t.id}`} onClick={()=>{setTime(slot);setTherapistId(t.id);setAppointments(p=>[...p.filter(a=>a.date!==activeDate),{date:activeDate,time:slot,therapistId:t.id}])}} className={`time-slot ${time===slot&&therapistId===t.id?"selected":""}`}>
                              <div style={{fontWeight:600}}>{getDisplaySlot(slot,req,isHausbesuch)}</div><div style={{fontSize:"12px",opacity:.8}}>👤 {t.name}</div>
                            </button>)) })
                        :activeSlots.map(slot=>(
                            <button key={slot} onClick={()=>{setTime(slot);setAppointments(p=>[...p.filter(a=>a.date!==activeDate),{date:activeDate,time:slot,therapistId}])}} className={`time-slot ${time===slot?"selected":""}`}>
                              <div style={{fontWeight:600}}>{getDisplaySlot(slot,req,isHausbesuch)}</div><div style={{fontSize:"12px",opacity:.8}}>👤 Verfügbar</div>
                            </button>))
                      }
                    </div>
                  </>}
                </>}
              </div>
            </div>

            {/* Next button */}
            <button className={`submit-btn ${!time||!activeDate?"disabled":""}`} disabled={!time||!activeDate} onClick={()=>{if(time&&activeDate)setStep(5)}}>
              Weiter → Persönliche Daten
            </button>
          </div>}

          {/* STEP 5 — Persönliche Daten + Dokumente */}
          {step===5&&<div className="fade-in-up">
            <BackButton onClick={()=>setStep(4)}/>
            <StepBadge num={5} text="Persönliche Daten"/>

            <div className="summary-box" style={{marginBottom:20}}>
              <h3>Ausgewählte Termine</h3>
              {(appointments.length>0?appointments:[{date:activeDate,time,therapistId}]).map((apt,i)=>(
                <div key={i} style={{fontSize:"13px",color:"#374151",marginBottom:4}}>
                  📅 {new Date(apt.date).toLocaleDateString("de-DE")} · {getDisplaySlot(apt.time,req,isHausbesuch)} · {apt.therapistId?(therapistsForBooking.find(t=>t.id===apt.therapistId)||therapists.find(t=>t.id===apt.therapistId))?.name||"Egal":"Egal"}
                </div>
              ))}
            </div>

            <div className="step5-form">
              <div className="form-row-2">
                <div className="input-group">
                  <label>Ihr Name *</label>
                  <input type="text" placeholder="Max Mustermann" value={name} onChange={e=>setName(e.target.value)} className="text-input" maxLength={100}/>
                </div>
                <div className="input-group">
                  <label>Telefonnummer *</label>
                  <input type="tel" placeholder="+49 123 456789" value={phone} onChange={e=>setPhone(e.target.value)} className="text-input" maxLength={30}/>
                </div>
              </div>
              <div className="input-group">
                <label>Ihre E-Mail *</label>
                <input type="email" placeholder="max@email.de" value={email} onChange={e=>setEmail(e.target.value)} className="text-input" maxLength={254}/>
              </div>
              <div className="input-group">
                <label>Nachricht (optional)</label>
                <textarea placeholder="Ihre Nachricht an die Praxis…" value={message} onChange={e=>setMessage(e.target.value)} className="text-input textarea-input" maxLength={2000} rows={4}/>
                <span className="char-count">{message.length}/2000 Zeichen</span>
              </div>

              {/* Verordnung des Arztes */}
              <div className="upload-section">
                <label className="upload-label">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Verordnung des Arztes (optional)
                </label>
                <p className="upload-hint">Für eine optimale Vorbereitung können Sie hier Ihre Verordnung hochladen. Max. 5 Dateien, je max. 5 MB.</p>
                <input type="file" accept="image/*,.pdf" multiple className="file-input" id="prescription-input"
                  onChange={e=>{ const files=Array.from(e.target.files||[]); if(files.length>5){setStatusMsg("❌ Maximal 5 Dateien erlaubt.");return} const tooBig=files.find(f=>f.size>5*1024*1024); if(tooBig){setStatusMsg("❌ Datei zu groß (max. 5 MB).");return} setPrescriptionFiles(files); setStatusMsg("") }}/>
                <label htmlFor="prescription-input" className="file-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Datei wählen
                </label>
                {prescriptionFiles.length>0&&(
                  <div className="file-list">
                    {prescriptionFiles.map((f,i)=>(
                      <div key={i} className="file-item">
                        <span>📄 {f.name}</span>
                        <button onClick={()=>setPrescriptionFiles(p=>p.filter((_,j)=>j!==i))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* DSGVO */}
              <div className="dsgvo-section">
                <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="dsgvo-link-card">
                  Datenschutzerklärung lesen →
                </a>
                <label className="dsgvo-row">
                  <input type="checkbox" checked={dsgvo} onChange={e=>setDsgvo(e.target.checked)}/>
                  <span>
                    Ich habe die{" "}
                    <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="dsgvo-link" onClick={e=>e.stopPropagation()}>
                      Datenschutzerklärung
                    </a>
                    {" "}gelesen und bin damit einverstanden, dass meine personenbezogenen Daten gemäß den darin enthaltenen Bestimmungen verarbeitet werden. *
                  </span>
                </label>
              </div>

              <button onClick={handleSubmit} disabled={loading||uploadingFiles||!name||!email||!phone||!dsgvo}
                className={`submit-btn ${loading||uploadingFiles||!name||!email||!phone||!dsgvo?"disabled":""}`}>
                {loading||uploadingFiles?<><span className="spinner"/>{uploadingFiles?"Dokumente werden hochgeladen…":"Buchung wird verarbeitet…"}</>:<>✅ Termin jetzt buchen</>}
              </button>
            </div>
          </div>}
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .book-wrapper{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px 20px}
        .book-card{width:100%;max-width:900px;background:rgba(255,255,255,.98);border-radius:24px;box-shadow:0 25px 80px rgba(0,0,0,.25);overflow:hidden}
        .book-header{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:40px 30px;text-align:center;color:white}
        .book-icon{width:60px;height:60px;background:rgba(255,255,255,.15);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:28px}
        .book-header h1{margin:0 0 8px;font-size:28px;font-weight:700}.book-header p{margin:0;opacity:.7;font-size:15px}
        .progress-track{height:4px;background:#e8e8e8}.progress-fill{height:100%;background:linear-gradient(90deg,#667eea,#764ba2);transition:width .5s;border-radius:0 2px 2px 0}
        .book-content{padding:30px}.fade-in-up{animation:fadeInUp .4s ease}
        .message-box{margin-bottom:24px;padding:16px 20px;border-radius:14px;text-align:center;font-weight:600;font-size:15px}
        .message-box.success{background:linear-gradient(135deg,#d4edda,#c3e6cb);color:#155724;border:1px solid #c3e6cb}
        .message-box.error{background:linear-gradient(135deg,#f8d7da,#f5c6cb);color:#721c24;border:1px solid #f5c6cb}
        .message-box.info{background:linear-gradient(135deg,#d1ecf1,#bee5eb);color:#0c5460;border:1px solid #bee5eb}
        .step-badge-wrap{display:flex;align-items:center;gap:12px;margin-bottom:24px}
        .step-badge-num{width:40px;height:40px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:12px;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:16px;flex-shrink:0}
        .step-badge-text{margin:0;font-size:22px;font-weight:700;color:#1a1a2e}
        .back-btn{margin-bottom:20px;border:none;background:transparent;cursor:pointer;font-size:14px;font-weight:600;color:#667eea;display:flex;align-items:center;gap:6px;padding:8px 0}
        .back-btn:hover{color:#764ba2}
        .option-list{display:flex;flex-direction:column;gap:12px}
        .option-card{padding:18px 20px;border-radius:16px;border:1px solid #e8e8e8;background:white;cursor:pointer;font-size:16px;display:flex;align-items:center;gap:16px;transition:all .2s;text-align:left;width:100%}
        .option-card:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(0,0,0,.08)}
        .option-card.selected{background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;border-color:#1a1a2e}
        .option-icon{font-size:24px}.option-label{font-weight:600;flex:1}.option-sub{font-size:13px;opacity:.65;margin-top:2px}.option-check{font-size:20px;margin-left:auto}
        .hb-card.selected .option-sub{opacity:.85}
        .service-list{display:flex;flex-direction:column;gap:12px}
        .service-card{padding:20px;border-radius:16px;border:1px solid #e8e8e8;background:white;cursor:pointer;text-align:left;width:100%;transition:all .2s}
        .service-card:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(0,0,0,.08)}
        .service-card.selected{background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;border-color:#1a1a2e}
        .service-title{font-weight:700;font-size:15px;margin-bottom:4px;display:flex;align-items:center;gap:8px}
        .service-subtitle{font-size:13px;opacity:.6;margin-bottom:8px}.service-card.selected .service-subtitle{opacity:.8}
        .service-meta{display:flex;gap:12px;font-size:13px;font-weight:600}
        .service-meta span{padding:4px 10px;border-radius:8px}
        .service-meta .duration{background:#f0f0f0}.service-card.selected .service-meta .duration{background:rgba(255,255,255,.15)}
        .service-meta .price{background:#d4edda;color:#155724}.service-card.selected .service-meta .price{background:rgba(255,255,255,.15);color:white}
        .service-check{background:rgba(255,255,255,.2);border-radius:6px;padding:2px 8px;font-size:12px}
        .therapist-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
        .therapist-card{padding:20px 16px;border-radius:16px;border:1px solid #e8e8e8;background:white;cursor:pointer;font-weight:600;font-size:15px;transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:8px}
        .therapist-card:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(0,0,0,.08)}
        .therapist-card.selected{background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;border-color:#1a1a2e}
        .therapist-avatar{font-size:32px}.therapist-check{font-size:12px;opacity:.8;background:rgba(255,255,255,.15);padding:2px 8px;border-radius:6px}
        .summary-box{background:linear-gradient(135deg,#f8f9fa,#e9ecef);border-radius:16px;padding:20px;margin-bottom:24px;border:1px solid #e8e8e8}
        .summary-box h3{margin:0 0 12px;font-size:14px;font-weight:700;color:#667eea;text-transform:uppercase;letter-spacing:1px}
        .summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;color:#444}
        .summary-grid span{color:#888}.summary-grid strong{color:#1a1a2e}
        .calendar-time-split{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}
        @media(max-width:768px){.calendar-time-split{grid-template-columns:1fr}.form-row-2{grid-template-columns:1fr!important}}
        .calendar-panel{background:white;border-radius:16px;padding:20px;border:1px solid #e8e8e8}
        .calendar-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
        .nav-arrow{width:36px;height:36px;border-radius:10px;border:1px solid #e8e8e8;background:white;cursor:pointer;font-size:20px;font-weight:700;color:#1a1a2e;display:flex;align-items:center;justify-content:center}
        .nav-arrow:hover{background:#f5f5f5}
        .calendar-title{text-align:center}.month-name{font-size:20px;font-weight:700;color:#1a1a2e}.year-name{font-size:14px;color:#888;margin-top:2px}
        .weekday-row{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:8px}
        .weekday-cell{text-align:center;font-size:12px;font-weight:700;color:#888;padding:8px 0}
        .days-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
        .day-cell{aspect-ratio:1;border-radius:10px;border:1px solid transparent;background:white;cursor:pointer;font-size:14px;font-weight:600;color:#1a1a2e;display:flex;align-items:center;justify-content:center;transition:all .15s;padding:0}
        .day-cell:hover:not(.empty):not(.past):not(.no-work){background:#f0f0f0;border-color:#ddd}
        .day-cell.empty{background:transparent;cursor:default}.day-cell.past{color:#ccc;cursor:not-allowed;background:#fafafa}
        .day-cell.no-work{color:#ddd;cursor:not-allowed;background:#fafafa;text-decoration:line-through}
        .day-cell.today{border-color:#667eea;color:#667eea}
        .day-cell.selected{background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;border-color:#1a1a2e}
        .day-cell.active{box-shadow:0 0 0 3px #667eea}
        .timezone{margin-top:12px;font-size:11px;color:#aaa;text-align:center}
        .time-panel{background:white;border-radius:16px;padding:20px;border:1px solid #e8e8e8}
        .session-tabs{display:flex;margin-bottom:16px;border-bottom:2px solid #e8e8e8}
        .session-tab{flex:1;padding:12px;border:none;background:transparent;cursor:pointer;font-size:15px;font-weight:600;color:#888;position:relative;transition:color .2s}
        .session-tab:hover{color:#667eea}.session-tab.active{color:#1a1a2e}
        .session-tab.active::after{content:'';position:absolute;bottom:-2px;left:0;right:0;height:2px;background:linear-gradient(90deg,#667eea,#764ba2)}
        .time-slots-grid{display:flex;flex-wrap:wrap;gap:10px;max-height:380px;overflow-y:auto}
        .time-slot{padding:12px 16px;border-radius:12px;border:1px solid #e8e8e8;background:white;cursor:pointer;font-weight:600;font-size:14px;color:#1a1a2e;transition:all .2s;text-align:left;display:flex;flex-direction:column;gap:4px;min-width:140px;flex:1 1 calc(50% - 5px)}
        .time-slot:hover{border-color:#667eea;transform:translateX(4px)}
        .time-slot.selected{background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;border-color:#1a1a2e}
        .no-slots{text-align:center;padding:30px 20px;color:#888;font-size:14px;line-height:1.8}
        .select-session-hint{text-align:center;padding:40px 20px;color:#888;font-size:14px}
        .submit-btn{width:100%;padding:18px;border-radius:16px;border:none;background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;cursor:pointer;font-size:17px;font-weight:700;transition:all .3s;box-shadow:0 8px 25px rgba(26,26,46,.3);display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px}
        .submit-btn:hover:not(.disabled){transform:translateY(-2px)}
        .submit-btn.disabled{background:#e8e8e8;color:#999;cursor:not-allowed;box-shadow:none}
        .spinner{display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,.3);border-top-color:white;border-radius:50%;animation:spin .8s linear infinite}
        .date-chip{position:relative;padding:8px 28px 8px 12px;border-radius:12px;border:2px solid #e8e8e8;background:white;cursor:pointer;font-size:13px;font-weight:600;color:#1a1a2e;transition:all .2s;text-align:center}
        .date-chip:hover{border-color:#667eea}.date-chip.active{background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;border-color:#1a1a2e}
        .chip-time{font-size:11px;opacity:.7;margin-top:2px}.date-chip.active .chip-time{opacity:.8}
        .chip-remove{position:absolute;top:2px;right:6px;font-size:16px;color:#999;cursor:pointer;line-height:1}
        /* Step 5 */
        .step5-form{display:flex;flex-direction:column;gap:16px}
        .form-row-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .input-group{display:flex;flex-direction:column;gap:6px}
        .input-group label{font-size:14px;font-weight:600;color:#444}
        .text-input{padding:14px 16px;border-radius:14px;border:2px solid #e8e8e8;width:100%;font-size:15px;outline:none;transition:border-color .2s;box-sizing:border-box;font-family:inherit}
        .text-input:focus{border-color:#667eea;box-shadow:0 0 0 3px rgba(102,126,234,.1)}
        .textarea-input{resize:vertical;min-height:100px}
        .char-count{font-size:11px;color:#9ca3af;text-align:right}
        /* Upload */
        .upload-section{border:2px dashed #e5e7eb;border-radius:14px;padding:20px;background:#fafafa}
        .upload-label{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#374151;margin-bottom:6px}
        .upload-hint{font-size:12px;color:#9ca3af;margin:0 0 12px}
        .file-input{display:none}
        .file-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:#fff;border:1.5px solid #e5e7eb;color:#374151;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
        .file-btn:hover{border-color:#667eea;color:#667eea;background:#f5f3ff}
        .file-list{margin-top:12px;display:flex;flex-direction:column;gap:6px}
        .file-item{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#374151}
        .file-item button{border:0;background:transparent;color:#ef4444;font-size:16px;cursor:pointer;line-height:1}
        /* DSGVO */
        .dsgvo-row{display:flex;align-items:flex-start;gap:12px;padding:16px;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:12px;cursor:pointer}
        .dsgvo-row input{margin-top:3px;flex-shrink:0;width:16px;height:16px}
        .dsgvo-row span{font-size:13px;color:#0c4a6e;line-height:1.6}
        .dsgvo-section{display:flex;flex-direction:column;gap:12px}
        .dsgvo-link-card{display:block;padding:14px 16px;border:1.5px solid #bae6fd;border-radius:12px;background:#f0f9ff;color:#0c4a6e;font-size:14px;font-weight:700;text-align:center;text-decoration:none;transition:all .15s}
        .dsgvo-link-card:hover{border-color:#667eea;color:#667eea;background:#e8f4ff}
        .dsgvo-link{color:#667eea;font-weight:700;text-decoration:underline}
        .dsgvo-link:hover{color:#764ba2}
      `}</style>
    </div>
  )
}

function StepBadge({num,text}:{num:number;text:string}){return<div className="step-badge-wrap"><div className="step-badge-num">{num}</div><h2 className="step-badge-text">{text}</h2></div>}
function BackButton({onClick}:{onClick:()=>void}){return<button onClick={onClick} className="back-btn">← Zurück</button>}
function ServiceCard({service,isSelected,onClick}:{service:ServiceItem;isSelected:boolean;onClick:()=>void}){
  return<button onClick={onClick} className={`service-card ${isSelected?"selected":""}`}><div className="service-title">{service.title}{isSelected&&<span className="service-check">✓</span>}</div><div className="service-subtitle">{service.subtitle}</div><div className="service-meta"><span className="duration">⏱ {service.duration}</span>{service.price&&<span className="price">💶 {service.price}</span>}</div></button>
}
function TherapistCard({name,isSelected,onClick}:{name:string;isSelected:boolean;onClick:()=>void}){
  return<button onClick={onClick} className={`therapist-card ${isSelected?"selected":""}`}><div className="therapist-avatar">👤</div><div>{name}</div>{isSelected&&<div className="therapist-check">✓</div>}</button>
}
