import { useRef } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'

const PORTRAIT =
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=800&auto=format&fit=crop'

export default function Hero() {
  const constraintsRef = useRef(null)

  const scrollTo = (id) => {
    const el = document.querySelector(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section
      id="top"
      className="relative min-h-screen overflow-hidden bg-[#0d1116]"
      style={{
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      >
        <span className="select-none font-display text-[20vw] font-bold leading-none tracking-tighter text-white opacity-[0.02]">
          BUILD
        </span>
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-12 px-5 pb-16 pt-28 sm:px-8 lg:grid-cols-2 lg:gap-8 lg:px-10 lg:pb-10">
        {/* Left — copy */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.32, 0.72, 0, 1] }}
          className="relative z-10"
        >
          <div className="mb-6 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-[#00df8f] shadow-[0_0_12px_rgba(0,223,143,0.8)]" />
            <span className="text-xs font-semibold uppercase tracking-widest text-gray-300 sm:text-sm">
              Full-Stack Engineer
            </span>
          </div>

          <h1 className="font-display text-5xl font-bold tracking-tighter leading-[0.9] sm:text-6xl md:text-7xl lg:text-[5.5rem]">
            <span className="text-white">DIGITAL</span>
            <br />
            <span className="outline-text">SYSTEMS</span>
            <span className="text-[#00df8f]">.</span>
          </h1>

          <p className="mt-8 max-w-md text-base leading-relaxed text-gray-400 sm:text-lg">
            I design and ship resilient full-stack products — APIs, cloud
            infrastructure, and AI pipelines — that turn complex problems into
            reliable, production-grade experiences.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => scrollTo('#work')}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#00df8f] to-[#00b373] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_rgba(0,223,143,0.25)] transition-shadow hover:shadow-[0_0_40px_rgba(0,223,143,0.4)]"
            >
              View My Work
              <ArrowUpRight className="h-4 w-4" />
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => scrollTo('#contact')}
              className="inline-flex items-center gap-3 rounded-full border border-white/20 bg-[#14181f] px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:border-[#00df8f]/50"
            >
              Contact Me
              <span className="h-2 w-2 rounded-full bg-[#00df8f]" />
            </motion.button>
          </div>
        </motion.div>

        {/* Right — draggable ID badge */}
        <div
          ref={constraintsRef}
          className="relative flex min-h-[420px] items-center justify-center lg:min-h-[560px]"
        >
          {/* Lanyard */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 z-0 h-[220px] w-10 -translate-x-1/2 bg-gradient-to-b from-[#00df8f]/40 via-[#14181f] to-transparent sm:-top-40 sm:h-[280px]"
            style={{
              clipPath: 'polygon(35% 0, 65% 0, 80% 100%, 20% 100%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-[88px] left-1/2 z-20 h-4 w-10 -translate-x-1/2 rounded-sm border border-white/20 bg-[#1a1f28] sm:top-[100px]"
          />

          <motion.div
            drag
            dragConstraints={constraintsRef}
            dragElastic={0.2}
            dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
            animate={{ y: [0, -15, 0], rotateZ: [-1, 1, -1] }}
            transition={{
              y: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' },
              rotateZ: { duration: 5, repeat: Infinity, ease: 'easeInOut' },
            }}
            whileHover={{ cursor: 'grab' }}
            whileDrag={{ cursor: 'grabbing', scale: 1.02 }}
            className="relative z-10 w-[260px] touch-none select-none sm:w-[300px] md:w-[320px]"
          >
            <div className="overflow-hidden rounded-3xl border border-white/15 bg-[#1a1f28] p-2 shadow-[0_25px_80px_rgba(0,0,0,0.55)]">
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/10 bg-[#14181f]">
                <img
                  src={PORTRAIT}
                  alt="Mohammad Fardeen Shaik"
                  className="h-full w-full object-cover"
                  draggable={false}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0d1116] via-[#0d1116]/85 to-transparent px-5 pb-6 pt-24">
                  <p className="font-display text-2xl font-bold tracking-tight text-white">
                    Fardeen<span className="text-[#00df8f]">.</span>
                  </p>
                  <p className="mt-1 text-sm text-gray-400">
                    Full-Stack Engineer
                  </p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center text-xs uppercase tracking-widest text-gray-500">
              Drag me around
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
