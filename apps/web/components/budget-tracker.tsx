"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, Pencil, Trash2, Check, X } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = { id: string; name: string; amount: number; color: string }
type StoredData  = { income: number; categories: Category[] }
type Status      = "good" | "warning" | "over"

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "orion-budget-tracker"
const MONTH = new Date().toLocaleString("en-US", { month: "long", year: "numeric" })

// Vibrant-but-refined palette — pops on deep dark without looking neon
const PALETTE = [
  "#a78bfa", // violet-400
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#38bdf8", // sky-400
  "#fb7185", // rose-400
  "#818cf8", // indigo-400
  "#2dd4bf", // teal-400
  "#fb923c", // orange-400
  "#c084fc", // purple-400
  "#4ade80", // green-400
] as const

const STATUS_MAP = {
  good:    { label: "On track",    hex: "#34d399", glow: "rgba(52,211,153,0.12)"   },
  warning: { label: "Watch it",    hex: "#fbbf24", glow: "rgba(251,191,36,0.12)"   },
  over:    { label: "Over budget", hex: "#fb7185", glow: "rgba(251,113,133,0.12)"  },
} as const

// ─── Shared style tokens ──────────────────────────────────────────────────────

const GLASS: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 48px rgba(0,0,0,0.4)",
}

const INPUT_BASE =
  "w-full bg-transparent focus:outline-none placeholder:text-white/15 text-white transition-colors duration-150"

// ─── Sounds (Web Audio API — no files, no deps) ───────────────────────────────

function useSounds() {
  const ctxRef = useRef<AudioContext | null>(null)

  const ctx = () => {
    if (!ctxRef.current)
      ctxRef.current = new (window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    return ctxRef.current
  }

  /** Play a single synthesised tone */
  const tone = (
    ac: AudioContext,
    freq: number,
    start: number,
    duration: number,
    vol = 0.22,
    type: OscillatorType = "sine",
  ) => {
    const osc  = ac.createOscillator()
    const gain = ac.createGain()
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.type = type
    osc.frequency.setValueAtTime(freq, ac.currentTime + start)
    gain.gain.setValueAtTime(0, ac.currentTime + start)
    gain.gain.linearRampToValueAtTime(vol, ac.currentTime + start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration)
    osc.start(ac.currentTime + start)
    osc.stop(ac.currentTime + start + duration + 0.02)
  }

  return {
    /** Bright rising arpeggio — "cha-ching" when adding an expense */
    playAdd() {
      try {
        const ac = ctx()
        tone(ac, 523,  0,    0.12, 0.18) // C5
        tone(ac, 659,  0.07, 0.12, 0.18) // E5
        tone(ac, 1047, 0.14, 0.22, 0.20) // C6 — the bright "fah" at the top
      } catch { /* AudioContext blocked: silently ignore */ }
    },

    /** Warm three-note chord — satisfying "got money" when income is set */
    playIncome() {
      try {
        const ac = ctx()
        tone(ac, 261, 0,    0.30, 0.14) // C4
        tone(ac, 329, 0.02, 0.28, 0.14) // E4
        tone(ac, 392, 0.04, 0.35, 0.16) // G4
        tone(ac, 784, 0.06, 0.30, 0.12) // G5 shimmer
      } catch { /* ignore */ }
    },

    /** Soft descending pop — gentle when deleting */
    playDelete() {
      try {
        const ac = ctx()
        tone(ac, 440, 0,    0.08, 0.16) // A4
        tone(ac, 280, 0.06, 0.14, 0.12) // E4 drop
      } catch { /* ignore */ }
    },

    /** Quick ascending double-tick — clean confirmation on save */
    playSave() {
      try {
        const ac = ctx()
        tone(ac, 600, 0,    0.08, 0.16)
        tone(ac, 900, 0.07, 0.12, 0.16)
      } catch { /* ignore */ }
    },
  }
}

// ─── Utility: currency formatter ──────────────────────────────────────────────

function useFmt() {
  return useCallback(
    (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency", currency: "USD", maximumFractionDigits: 0,
      }).format(n),
    []
  )
}

// ─── Ring chart ───────────────────────────────────────────────────────────────

function RingChart({
  categories, total, savingsRate,
}: {
  categories: Category[]; total: number; savingsRate: number
}) {
  const SIZE   = 196
  const STROKE = 18
  const R      = (SIZE - STROKE) / 2
  const C      = 2 * Math.PI * R

  let cursor = 0
  const slices = categories.map((cat) => {
    const frac    = cat.amount / total
    const gapFrac = 2.5 / C
    const dash    = Math.max(0, frac - gapFrac) * C
    const dashOff = C - cursor * C
    cursor += frac
    return { ...cat, dash, dashOff }
  })

  return (
    <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
      {/* Ambient glow behind chart */}
      <div
        className="absolute inset-4 rounded-full blur-2xl opacity-30 pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(167,139,250,0.4) 0%, transparent 70%)" }}
      />
      <svg
        width={SIZE} height={SIZE}
        style={{ transform: "rotate(-90deg)", position: "relative" }}
        aria-hidden
      >
        {/* Track */}
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={STROKE}
        />
        {total > 0 && slices.map((s) => (
          <circle
            key={s.id}
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${s.dash} ${C}`}
            strokeDashoffset={s.dashOff}
            style={{ transition: "stroke-dasharray 0.65s cubic-bezier(0.4,0,0.2,1), stroke-dashoffset 0.65s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 4px ${s.color}66)` }}
          />
        ))}
      </svg>
      {/* Centre label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
        {total === 0 ? (
          <span className="text-white/20 text-2xl">·</span>
        ) : (
          <>
            <span
              className="tabular-nums font-bold leading-none tracking-tight"
              style={{ fontSize: 30, color: "#fff" }}
            >
              {Math.round(savingsRate)}
              <span style={{ fontSize: 16, fontWeight: 400, color: "rgba(255,255,255,0.4)" }}>%</span>
            </span>
            <span className="text-[10px] tracking-[0.18em] uppercase mt-1.5" style={{ color: "rgba(255,255,255,0.3)" }}>
              saved
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Animated progress bar ────────────────────────────────────────────────────

function Bar({
  value, max, color, height = 2,
}: {
  value: number; max: number; color: string; height?: number
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height, background: "rgba(255,255,255,0.06)" }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: color,
          boxShadow: `0 0 8px ${color}55`,
          transition: "width 0.65s cubic-bezier(0.4,0,0.2,1)",
        }}
      />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BudgetTracker() {
  const [income,     setIncome]     = useState(0)
  const [incomeRaw,  setIncomeRaw]  = useState("")
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoaded,   setIsLoaded]   = useState(false)

  const [showAdd,    setShowAdd]    = useState(false)
  const [addName,    setAddName]    = useState("")
  const [addAmount,  setAddAmount]  = useState("")

  const [editId,     setEditId]     = useState<string | null>(null)
  const [editName,   setEditName]   = useState("")
  const [editAmount, setEditAmount] = useState("")

  const nameRef = useRef<HTMLInputElement>(null)
  const fmt     = useFmt()
  const sounds  = useSounds()

  // ── Persistence ──────────────────────────────────────────────────────────

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const d: StoredData = JSON.parse(raw)
        setIncome(d.income ?? 0)
        setIncomeRaw(d.income > 0 ? String(d.income) : "")
        setCategories(d.categories ?? [])
      }
    } catch { /* ignore */ }
    setIsLoaded(true)
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ income, categories }))
  }, [income, categories, isLoaded])

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalSpent  = categories.reduce((s, c) => s + c.amount, 0)
  const remaining   = income - totalSpent
  const savingsRate = income > 0 ? Math.max(0, ((income - totalSpent) / income) * 100) : 0
  const spentPct    = income > 0 ? Math.round((totalSpent / income) * 100) : 0

  const status: Status =
    income <= 0          ? "good"
    : remaining >= income * 0.2 ? "good"
    : remaining >= 0     ? "warning"
    : "over"

  const st = STATUS_MAP[status]

  // ── Handlers ─────────────────────────────────────────────────────────────

  const commitIncome = () => {
    const val = parseFloat(incomeRaw.replace(/,/g, "")) || 0
    if (val > 0) sounds.playIncome()
    setIncome(val)
    setIncomeRaw(val > 0 ? val.toLocaleString("en-US") : "")
  }

  const nextColor = (): string => PALETTE[categories.length % PALETTE.length] ?? PALETTE[0]

  const handleAdd = () => {
    const name   = addName.trim()
    const amount = parseFloat(addAmount) || 0
    if (!name || amount <= 0) return
    sounds.playAdd()
    setCategories(p => [...p, { id: crypto.randomUUID(), name, amount, color: nextColor() }])
    setAddName(""); setAddAmount(""); setShowAdd(false)
  }

  const onAddKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  handleAdd()
    if (e.key === "Escape") { setShowAdd(false); setAddName(""); setAddAmount("") }
  }

  const startEdit = (c: Category) => {
    setEditId(c.id); setEditName(c.name); setEditAmount(String(c.amount))
  }

  const saveEdit = () => {
    if (!editId) return
    const amount = parseFloat(editAmount) || 0
    sounds.playSave()
    setCategories(p => p.map(c => c.id === editId ? { ...c, name: editName.trim() || c.name, amount } : c))
    setEditId(null)
  }

  const onEditKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  saveEdit()
    if (e.key === "Escape") setEditId(null)
  }

  if (!isLoaded) return null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-svh text-white"
      style={{
        background: "linear-gradient(160deg, #0d0d18 0%, #08080f 60%)",
        touchAction: "pan-y",
        WebkitOverflowScrolling: "touch",
      } as React.CSSProperties}
    >
      <div className="max-w-md mx-auto px-5 pt-12 pb-24 space-y-4">

        {/* ── Page header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-1 pb-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.16em] uppercase"
               style={{ color: "rgba(255,255,255,0.3)" }}>
              {MONTH}
            </p>
            <h1 className="text-[22px] font-semibold tracking-tight text-white mt-0.5">
              Budget
            </h1>
          </div>

          {/* Status pill */}
          {income > 0 && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                background: `${st.hex}14`,
                border: `1px solid ${st.hex}30`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: st.hex, boxShadow: `0 0 6px ${st.hex}` }}
              />
              <span className="text-[12px] font-medium" style={{ color: st.hex }}>
                {st.label}
              </span>
            </div>
          )}
        </div>

        {/* ── Hero income card ────────────────────────────────────── */}
        <div
          className="rounded-3xl p-6 relative overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #1a1330 0%, #110f1e 40%, #0d0c18 100%)",
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.10), 0 0 0 1px rgba(255,255,255,0.06), 0 40px 80px rgba(0,0,0,0.5), 0 16px 40px ${st.glow}`,
            transition: "box-shadow 0.6s ease",
          }}
        >
          {/* Ambient violet orb */}
          <div
            className="absolute -top-10 -left-10 w-56 h-56 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)",
              filter: "blur(24px)",
            }}
          />

          {/* Income label + input */}
          <div className="relative z-10">
            <p className="text-[11px] font-medium tracking-[0.16em] uppercase mb-4"
               style={{ color: "rgba(255,255,255,0.35)" }}>
              Monthly income
            </p>

            <div className="flex items-baseline gap-2">
              <span
                className="text-3xl font-light select-none"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={incomeRaw}
                onChange={e => setIncomeRaw(e.target.value)}
                onBlur={commitIncome}
                placeholder="0"
                className={`${INPUT_BASE} text-[48px] font-bold tracking-tight tabular-nums leading-none flex-1 min-w-0`}
                style={{ caretColor: "#a78bfa" }}
              />
            </div>

            {/* Divider */}
            <div
              className="mt-6 mb-5 h-px"
              style={{ background: "rgba(255,255,255,0.07)" }}
            />

            {/* 3-stat strip */}
            {income > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Spent",   value: fmt(totalSpent), color: "rgba(255,255,255,0.7)" },
                  {
                    label: "Left",
                    value: fmt(Math.abs(remaining)),
                    color: remaining >= 0 ? "#34d399" : "#fb7185",
                  },
                  {
                    label: "Saved",
                    value: `${Math.round(savingsRate)}%`,
                    color: savingsRate >= 20 ? "#34d399" : savingsRate > 0 ? "#fbbf24" : "rgba(255,255,255,0.3)",
                  },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <p className="text-[10px] font-medium tracking-[0.14em] uppercase mb-1.5"
                       style={{ color: "rgba(255,255,255,0.28)" }}>
                      {label}
                    </p>
                    <p className="text-[16px] font-semibold tabular-nums leading-none" style={{ color }}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                Enter your income to get started
              </p>
            )}
          </div>
        </div>

        {/* ── Breakdown card ──────────────────────────────────────── */}
        {income > 0 && categories.length > 0 && (
          <div className="rounded-3xl p-6" style={GLASS}>
            <p className="text-[11px] font-medium tracking-[0.16em] uppercase mb-5"
               style={{ color: "rgba(255,255,255,0.28)" }}>
              Breakdown
            </p>

            <div className="flex items-center gap-6">
              <RingChart
                categories={categories}
                total={totalSpent}
                savingsRate={savingsRate}
              />

              {/* Legend */}
              <div className="flex-1 space-y-3.5 min-w-0">
                {categories.map(cat => (
                  <div key={cat.id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: cat.color, boxShadow: `0 0 4px ${cat.color}` }}
                      />
                      <span className="flex-1 text-[13px] truncate" style={{ color: "rgba(255,255,255,0.55)" }}>
                        {cat.name}
                      </span>
                      <span className="text-[13px] font-medium tabular-nums flex-shrink-0" style={{ color: "rgba(255,255,255,0.8)" }}>
                        {fmt(cat.amount)}
                      </span>
                    </div>
                    <Bar value={cat.amount} max={totalSpent} color={cat.color} />
                  </div>
                ))}
              </div>
            </div>

            {/* Overall utilisation bar */}
            <div className="mt-6 space-y-2">
              <Bar value={totalSpent} max={income} color={st.hex} height={3} />
              <div className="flex justify-between">
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {spentPct}% allocated
                </span>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {fmt(income)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Expenses section ────────────────────────────────────── */}
        <div className="space-y-3 pt-2">

          {/* Section header */}
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-medium tracking-[0.16em] uppercase"
               style={{ color: "rgba(255,255,255,0.28)" }}>
              Expenses
            </p>
            <button
              onClick={() => { setShowAdd(v => !v); setTimeout(() => nameRef.current?.focus(), 50) }}
              aria-label="Add expense"
              className="flex items-center gap-2 min-h-[44px] px-1 transition-opacity duration-150 active:opacity-60"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              <span
                className="w-[22px] h-[22px] rounded-full flex items-center justify-center"
                style={{ border: "1.5px solid rgba(255,255,255,0.2)" }}
              >
                <Plus size={11} strokeWidth={2.5} />
              </span>
              <span className="text-[13px] font-medium">Add</span>
            </button>
          </div>

          {/* Add form */}
          {showAdd && (
            <div
              className="rounded-2xl p-5 space-y-5"
              style={{
                background: "rgba(167,139,250,0.06)",
                border: "1px solid rgba(167,139,250,0.18)",
                boxShadow: "0 0 0 4px rgba(167,139,250,0.04)",
              }}
            >
              <input
                ref={nameRef}
                type="text"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                onKeyDown={onAddKey}
                placeholder="Expense name"
                className={`${INPUT_BASE} text-[15px] border-b pb-2`}
                style={{ borderColor: "rgba(255,255,255,0.1)", caretColor: "#a78bfa" }}
              />
              <div
                className="flex items-center gap-2 border-b pb-2 focus-within:border-white/25 transition-colors"
                style={{ borderColor: "rgba(255,255,255,0.1)" }}
              >
                <span className="text-[15px] select-none" style={{ color: "rgba(255,255,255,0.25)" }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={addAmount}
                  onChange={e => setAddAmount(e.target.value)}
                  onKeyDown={onAddKey}
                  placeholder="0"
                  className={`${INPUT_BASE} text-[15px] tabular-nums flex-1`}
                  style={{ caretColor: "#a78bfa" }}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleAdd}
                  disabled={!addName.trim() || !addAmount}
                  className="flex-1 min-h-[46px] rounded-xl text-[14px] font-semibold text-white transition-all duration-150 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ background: "rgba(139,92,246,0.35)", border: "1px solid rgba(139,92,246,0.4)" }}
                >
                  Add expense
                </button>
                <button
                  onClick={() => { setShowAdd(false); setAddName(""); setAddAmount("") }}
                  className="px-5 min-h-[46px] rounded-xl text-[14px] transition-all duration-150 active:scale-[0.97]"
                  style={{ color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {categories.length === 0 && !showAdd && (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1"
                style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
              >
                <Plus size={18} style={{ color: "rgba(255,255,255,0.2)" }} />
              </div>
              <p className="text-[15px] font-medium" style={{ color: "rgba(255,255,255,0.25)" }}>
                No expenses yet
              </p>
              <p className="text-[13px] leading-relaxed max-w-[220px]" style={{ color: "rgba(255,255,255,0.12)" }}>
                Track where your money goes by adding expense categories
              </p>
            </div>
          )}

          {/* Category list — single grouped card */}
          {categories.length > 0 && (
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 40px rgba(0,0,0,0.3)",
              }}
            >
              {categories.map((cat, i) => (
                <div key={cat.id}>
                  {/* Divider (skip first) */}
                  {i > 0 && (
                    <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginLeft: 48 }} />
                  )}

                  {editId === cat.id ? (
                    /* ── Edit row ── */
                    <div
                      className="flex items-center gap-3 px-4 py-4"
                      style={{ background: "rgba(167,139,250,0.06)" }}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: cat.color, boxShadow: `0 0 5px ${cat.color}` }}
                      />
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={onEditKey}
                        className={`${INPUT_BASE} flex-1 min-w-0 text-[14px] border-b pb-0.5`}
                        style={{ borderColor: "rgba(255,255,255,0.15)", caretColor: "#a78bfa" }}
                      />
                      <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                        <span className="text-[13px]">$</span>
                        <input
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          onKeyDown={onEditKey}
                          inputMode="decimal"
                          autoComplete="off"
                          className={`${INPUT_BASE} w-20 text-[14px] text-right tabular-nums border-b pb-0.5`}
                          style={{ borderColor: "rgba(255,255,255,0.15)", caretColor: "#a78bfa" }}
                        />
                      </div>
                      <button
                        onClick={saveEdit}
                        aria-label="Save"
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors duration-150 active:scale-90"
                        style={{ color: "#34d399" }}
                      >
                        <Check size={15} strokeWidth={2.5} />
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        aria-label="Cancel"
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors duration-150 active:scale-90"
                        style={{ color: "rgba(255,255,255,0.25)" }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    /* ── View row ── */
                    <div
                      className="group"
                      style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}
                    >
                      <div className="flex items-center gap-3 px-4 py-4">
                        {/* Color dot */}
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: cat.color, boxShadow: `0 0 5px ${cat.color}88` }}
                        />
                        {/* Name */}
                        <span className="flex-1 text-[14px] truncate" style={{ color: "rgba(255,255,255,0.75)" }}>
                          {cat.name}
                        </span>
                        {/* % of income */}
                        {income > 0 && (
                          <span
                            className="text-[11px] tabular-nums flex-shrink-0 mr-3 font-medium"
                            style={{ color: "rgba(255,255,255,0.2)" }}
                          >
                            {Math.round((cat.amount / income) * 100)}%
                          </span>
                        )}
                        {/* Amount */}
                        <span
                          className="text-[15px] font-semibold tabular-nums flex-shrink-0"
                          style={{ color: "rgba(255,255,255,0.9)" }}
                        >
                          {fmt(cat.amount)}
                        </span>
                        {/* Actions */}
                        <div className="flex items-center md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150 ml-1 gap-0">
                          <button
                            onClick={() => startEdit(cat)}
                            aria-label={`Edit ${cat.name}`}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center transition-all duration-150 active:scale-90"
                            style={{ color: "rgba(255,255,255,0.2)" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
                            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => { sounds.playDelete(); setCategories(p => p.filter(c => c.id !== cat.id)) }}
                            aria-label={`Delete ${cat.name}`}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center transition-all duration-150 active:scale-90"
                            style={{ color: "rgba(255,255,255,0.2)" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "#fb7185")}
                            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      {/* Progress bar */}
                      {income > 0 && (
                        <div className="px-4 pb-3 -mt-1">
                          <Bar value={cat.amount} max={income} color={cat.color} height={2} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        {income > 0 && categories.length > 0 && (
          <div
            className="flex items-center justify-between px-1 pt-4"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <span className="text-[12px] tabular-nums" style={{ color: "rgba(255,255,255,0.2)" }}>
              {fmt(totalSpent)} of {fmt(income)} used
            </span>
            <span className="text-[12px] font-medium" style={{ color: st.hex }}>
              {fmt(Math.abs(remaining))} {remaining >= 0 ? "remaining" : "over"}
            </span>
          </div>
        )}

      </div>
    </div>
  )
}
