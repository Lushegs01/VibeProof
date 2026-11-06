import { useId } from "react";

/** Original inline illustration. No external assets, tracking, or client JavaScript. */
export function HauntedScene() {
  const id = useId();
  return (
    <div className="haunted-scene" aria-hidden="true">
      <div className="scene-aura" />
      <div className="scene-illustration">
        <svg viewBox="0 0 560 540" fill="none" className="h-auto w-full">
          <defs>
            <radialGradient id={`${id}-moon`} cx=".35" cy=".3" r=".8">
              <stop stopColor="#fceac7" />
              <stop offset="1" stopColor="#bd9d77" />
            </radialGradient>
            <linearGradient id={`${id}-ghost`} x1="170" y1="170" x2="327" y2="335" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fff8e7" />
              <stop offset=".55" stopColor="#e6e5d5" />
              <stop offset="1" stopColor="#9bbbab" />
            </linearGradient>
            <linearGradient id={`${id}-book`} x1="132" y1="345" x2="365" y2="477" gradientUnits="userSpaceOnUse">
              <stop stopColor="#564060" />
              <stop offset="1" stopColor="#241a32" />
            </linearGradient>
            <radialGradient id={`${id}-pumpkin`} cx=".35" cy=".25" r=".9">
              <stop stopColor="#ffbd6e" />
              <stop offset=".45" stopColor="#ee7c38" />
              <stop offset="1" stopColor="#9d381e" />
            </radialGradient>
            <linearGradient id={`${id}-light`} x1="376" y1="263" x2="376" y2="345" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fff1ae" />
              <stop offset="1" stopColor="#ff9e48" />
            </linearGradient>
            <path id={`${id}-bat`} d="M0 8C4-3 11-2 15 5L18 1 21 5C25-2 32-3 36 8 30 6 28 9 27 13 23 10 20 12 18 17 16 12 13 10 9 13 8 9 6 6 0 8Z" />
          </defs>
          <circle cx="290" cy="278" r="215" stroke="#d9b9e3" strokeOpacity=".12" strokeDasharray="2 9" />
          <circle cx="290" cy="278" r="190" stroke="#d9b9e3" strokeOpacity=".07" />
          <circle cx="386" cy="129" r="79" fill={`url(#${id}-moon)`} />
          <circle cx="410" cy="99" r="14" fill="#9d836e" opacity=".17" />
          <circle cx="359" cy="140" r="20" fill="#9d836e" opacity=".12" />
          <circle cx="409" cy="164" r="9" fill="#9d836e" opacity=".18" />
          <path d="M80 335 88 300 99 282 107 304 115 308 121 272 135 254 147 275 151 320 173 320 173 281 183 268 193 285 197 338Z" fill="#211a2a" />
          <path d="m127 275 5-5 5 5v12h-10Zm52 23h9v14h-9ZM93 309h7v10h-7Z" fill="#ffb25e" opacity=".35" />
          <use href={`#${id}-bat`} transform="translate(420 220) rotate(-14) scale(1.1)" fill="#b29bc0" />
          <use href={`#${id}-bat`} transform="translate(288 93) rotate(12) scale(.7)" fill="#b29bc0" opacity=".7" />
          <use href={`#${id}-bat`} transform="translate(126 163) rotate(-15) scale(.6)" fill="#b29bc0" opacity=".5" />
          <path d="m93 221 3-9 3 9 9 3-9 3-3 9-3-9-9-3Zm389 108 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z" fill="#c5db9d" />
          <path d="m224 109 2-6 2 6 6 2-6 2-2 6-2-6-6-2Zm231 47 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z" fill="#ffb262" />
          <circle cx="154" cy="112" r="2" fill="#d7c4e2" />
          <circle cx="480" cy="260" r="2" fill="#d7c4e2" />
          <circle cx="329" cy="63" r="1.5" fill="#d7c4e2" />
          <ellipse cx="302" cy="491" rx="194" ry="21" fill="#000" opacity=".28" />
          <path
            d="M79 462c-12-32-19-55-17-86m14 77-27-14m20-19 15-19M479 464c7-23 18-46 33-62m-23 39 24-5m-12-16-1-14"
            stroke="#514457"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M56 416c-17-5-20-20-20-20 20-1 28 7 20 20Zm25-16c1-18 16-25 16-25 5 19-2 29-16 25Zm423 30c7-15 23-16 23-16-2 19-12 25-23 16Z"
            fill="#69764b"
          />
          {/* Bound evidence journal, with a paper edge and a stamped brand mark. */}
          <g transform="rotate(-10 265 404)">
            <rect x="130" y="348" width="261" height="132" rx="14" fill="#17111e" stroke="#7c5c73" />
            <path d="M144 355h231v111H144Z" fill="#e7d5b6" />
            <path d="M150 459h219m-219-5h219m-219-5h219" stroke="#a69377" strokeOpacity=".55" />
            <rect x="125" y="333" width="269" height="121" rx="12" fill={`url(#${id}-book)`} stroke="#9d748b" />
            <path d="M144 334v120" stroke="#b28088" strokeOpacity=".7" />
            <rect x="158" y="348" width="217" height="90" rx="6" stroke="#b78b90" strokeOpacity=".4" strokeDasharray="3 4" />
            <text x="180" y="374" fill="#f1dac1" fontSize="11" fontFamily="monospace" letterSpacing="3">
              VIBEPROOF
            </text>
            <text x="180" y="397" fill="#fff0d7" fontSize="17" fontFamily="Georgia,serif" fontStyle="italic">
              The evidence journal
            </text>
            <text x="180" y="420" fill="#c3a9c8" fontSize="8" fontFamily="monospace" letterSpacing="2">
              FOLLOW THE PAPER TRAIL
            </text>
            <path d="m344 373 15 9v17l-15 9-15-9v-17Z" stroke="#ffab60" strokeWidth="1.4" />
            <path d="m337 389 5 5 9-10" stroke="#ffcc9a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m164 451 1 37 12-7 11 7v-37Z" fill="#d97843" />
          </g>
          {/* Friendly investigator, holding a lantern rather than a verdict. */}
          <path d="M170 246c-24 10-36 26-42 42-2 6 2 10 9 6l40-26" fill="#b9cbbd" stroke="#97b3a4" strokeWidth="1.5" />
          <path
            d="M173 235c0-53 28-86 73-86 49 0 80 37 80 88v52c0 26 8 38 19 51-20 4-32-8-41-12-11 23-25 25-43 7-13 20-29 20-41 0-14 16-30 14-39-5-14 11-26 11-38 5 20-24 30-45 30-70Z"
            fill={`url(#${id}-ghost)`}
            stroke="#fff5df"
            strokeOpacity=".55"
            strokeWidth="1.5"
          />
          <path d="M178 231c5-41 23-66 53-73" stroke="#fffdf2" strokeWidth="5" strokeLinecap="round" opacity=".55" />
          <ellipse cx="228" cy="228" rx="9" ry="14" fill="#252332" />
          <ellipse cx="271" cy="224" rx="9" ry="14" fill="#252332" />
          <circle cx="231" cy="224" r="2.5" fill="#fff7e4" />
          <circle cx="274" cy="220" r="2.5" fill="#fff7e4" />
          <path d="M241 254q10 10 20-2" stroke="#555365" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="211" cy="250" rx="11" ry="5" fill="#e3ac98" opacity=".45" />
          <ellipse cx="287" cy="245" rx="10" ry="5" fill="#e3ac98" opacity=".4" />
          <path d="M306 265c22 12 39 11 50 0 9-9 19-2 12 9-14 25-42 25-62 13" fill="#cedacb" stroke="#c0d2c0" strokeWidth="1.5" />
          <path d="M368 272v18" stroke="#b69978" strokeWidth="3" />
          <path d="M359 290v-8a9 9 0 0 1 18 0v8" stroke="#d6ba8d" strokeWidth="3" />
          <circle cx="368" cy="319" r="39" fill="#ffb965" opacity=".06" />
          <path d="m354 290-8 52h45l-9-52Z" fill="#37242b" stroke="#ba875c" strokeWidth="2" />
          <path d="m361 298-5 35h25l-5-35Z" fill={`url(#${id}-light)`} />
          <path d="M367 333v-30m-17 36h37" stroke="#75422b" strokeWidth="3" />
          <path d="M369 330c-14-9 1-17 0-27 15 14 8 22 0 27Z" fill="#fff0b3" />
          {/* Jack-o'-lantern, with warm lit cut-outs. */}
          <path d="M418 385c-4-16 2-24 11-30l8 10c-8 6-10 12-9 20Z" fill="#718452" stroke="#98a46c" />
          <path
            d="M422 386c-54-25-81 8-72 48 8 37 31 47 67 43 42 9 76-9 78-43 4-39-24-68-73-48Z"
            fill={`url(#${id}-pumpkin)`}
            stroke="#fcaa61"
            strokeOpacity=".6"
            strokeWidth="1.5"
          />
          <path
            d="M420 391c-25 7-35 55-8 82m13-83c25 7 34 53 8 83m-30-78c-34 0-49 46-14 69m51-67c38-4 52 41 20 66"
            stroke="#8e3e25"
            strokeWidth="2"
            opacity=".45"
          />
          <path d="m379 412 23 6-24 13Zm56 5 24-8 2 20Zm-24 15 9-13 8 14Z" fill="#ffd984" />
          <path d="m381 443 18 6 3-9 13 12 13-1 11-14 5 10 18-10c-6 25-58 37-81 6Z" fill="#ffdc8c" />
          <path d="M355 474c42 9 93 7 125-4" stroke="#ffa755" strokeOpacity=".25" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <span className="scene-note scene-note-top">A curious spirit.</span>
      <span className="scene-note scene-note-bottom">An eye for the evidence.</span>
    </div>
  );
}
