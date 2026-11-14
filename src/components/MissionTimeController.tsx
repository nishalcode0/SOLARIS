
import { useState } from 'react'

interface MissionTimeControllerProps {
  simulationTime: Date
  onTimeChange: (time: Date) => void
  compact?: boolean
}

function toLocalInputValue(date: Date) {
  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  )

  return local.toISOString().slice(0, 16)
}

function getLocalHour(date: Date) {
  return date.getHours() + date.getMinutes() / 60
}

function formatHour(value: number) {
  const hours = Math.floor(value)
  const minutes = Math.round((value - hours) * 60)

  const normalizedHours = hours === 24 ? 0 : hours
  const period = normalizedHours >= 12 ? 'PM' : 'AM'
  const displayHour = normalizedHours % 12 || 12

  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`
}

export default function MissionTimeController({
  simulationTime,
  onTimeChange,
  compact = false,
}: MissionTimeControllerProps) {
  const [stepHours, setStepHours] = useState(1)

  const currentHour = getLocalHour(simulationTime)

  function changeByHours(direction: -1 | 1) {
    const next = new Date(simulationTime)

    next.setTime(
      next.getTime() + direction * stepHours * 60 * 60 * 1000,
    )

    onTimeChange(next)
  }

  function changeSlider(value: number) {
    const next = new Date(simulationTime)

    const hours = Math.floor(value)
    const minutes = Math.round((value - hours) * 60)

    next.setHours(hours, minutes, 0, 0)

    onTimeChange(next)
  }

  function changeDateTime(value: string) {
    if (!value) return

    const next = new Date(value)

    if (!Number.isNaN(next.getTime())) {
      onTimeChange(next)
    }
  }

  function resetToNow() {
    onTimeChange(new Date())
  }

  const panelStyle: React.CSSProperties = {
    width: '100%',
    padding: compact ? '13px 15px' : '16px',
    borderRadius: '12px',
    background: compact
      ? 'rgba(18, 25, 34, 0.94)'
      : '#f0e9dc',
    color: compact ? '#eee9df' : '#202b3a',
    border: compact
      ? '1px solid rgba(255,255,255,0.14)'
      : '1px solid rgba(32,43,58,0.14)',
    boxShadow: compact
      ? '0 8px 30px rgba(0,0,0,0.3)'
      : '0 4px 18px rgba(32,43,58,0.06)',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  }

  const mutedColor = compact ? '#aeb9c6' : '#68717c'
  const accentColor = '#e89a62'

  return (
    <section style={panelStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '12px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '1.3px',
              color: mutedColor,
            }}
          >
            MISSION TIME CONTROL
          </div>

          <div
            style={{
              fontSize: compact ? '21px' : '25px',
              fontWeight: 750,
              marginTop: '3px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {simulationTime.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={resetToNow}
          style={{
            padding: '7px 11px',
            borderRadius: '7px',
            border: `1px solid ${compact ? '#56616e' : '#c7c0b5'}`,
            background: 'transparent',
            color: 'inherit',
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.8px',
            cursor: 'pointer',
          }}
        >
          NOW
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: mutedColor,
          fontSize: '10px',
          marginBottom: '5px',
        }}
      >
        <span>00:00</span>
        <span>12:00</span>
        <span>24:00</span>
      </div>

      <input
        aria-label="Mission time of day"
        type="range"
        min="0"
        max="24"
        step="0.25"
        value={currentHour}
        onChange={(event) =>
          changeSlider(Number(event.target.value))
        }
        style={{
          width: '100%',
          accentColor,
          cursor: 'pointer',
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          marginTop: '4px',
          fontSize: '11px',
          color: mutedColor,
        }}
      >
        <span>Selected local time</span>
        <strong style={{ color: 'inherit' }}>
          {formatHour(currentHour)}
        </strong>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'end',
          gap: '8px',
          marginTop: '15px',
        }}
      >
        <button
          type="button"
          onClick={() => changeByHours(-1)}
          style={{
            minHeight: '38px',
            borderRadius: '7px',
            border: `1px solid ${compact ? '#56616e' : '#c7c0b5'}`,
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '11px',
          }}
        >
          − PREVIOUS
        </button>

        <label
          style={{
            display: 'grid',
            gap: '5px',
            fontSize: '9px',
            fontWeight: 800,
            color: mutedColor,
            textAlign: 'center',
          }}
        >
          STEP (HOURS)

          <input
            aria-label="Time adjustment step in hours"
            type="number"
            min="1"
            max="16"
            step="1"
            value={stepHours}
            onChange={(event) => {
              const value = Number(event.target.value)

              if (Number.isFinite(value)) {
                setStepHours(
                  Math.max(1, Math.min(16, Math.round(value))),
                )
              }
            }}
            style={{
              width: '66px',
              height: '35px',
              boxSizing: 'border-box',
              textAlign: 'center',
              borderRadius: '7px',
              border: `1px solid ${compact ? '#56616e' : '#c7c0b5'}`,
              background: compact ? '#252e39' : '#fffaf1',
              color: 'inherit',
              fontSize: '14px',
              fontWeight: 700,
            }}
          />
        </label>

        <button
          type="button"
          onClick={() => changeByHours(1)}
          style={{
            minHeight: '38px',
            borderRadius: '7px',
            border: 'none',
            background: accentColor,
            color: '#20252c',
            cursor: 'pointer',
            fontWeight: 800,
            fontSize: '11px',
          }}
        >
          NEXT +
        </button>
      </div>

      <div style={{ marginTop: '12px' }}>
        <label
          style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 800,
            letterSpacing: '0.8px',
            color: mutedColor,
            marginBottom: '6px',
          }}
        >
          SELECT SIMULATION DATE & TIME
        </label>

        <input
          aria-label="Select simulation date and time"
          type="datetime-local"
          value={toLocalInputValue(simulationTime)}
          onChange={(event) => changeDateTime(event.target.value)}
          style={{
            width: '100%',
            minHeight: '36px',
            boxSizing: 'border-box',
            padding: '6px 8px',
            borderRadius: '7px',
            border: `1px solid ${compact ? '#56616e' : '#c7c0b5'}`,
            background: compact ? '#252e39' : '#fffaf1',
            color: 'inherit',
            fontSize: '11px',
          }}
        />
      </div>

      <div
        style={{
          marginTop: '10px',
          fontSize: '9px',
          lineHeight: 1.5,
          color: mutedColor,
        }}
      >
        LOCAL CLOCK DISPLAY · SHARED MISSION SIMULATION TIME
      </div>
    </section>
  )
}
