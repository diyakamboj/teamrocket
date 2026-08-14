import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Minus } from 'lucide-react'

const stages = [
  {
    number: '01',
    title: 'BRIEFING',
    body: 'Align on goals, constraints, and success metrics. I dig into product requirements, stakeholder expectations, and the technical landscape before writing a single line of code.',
  },
  {
    number: '02',
    title: 'ANALYTICS',
    body: 'Map data flows, APIs, and infrastructure boundaries. Research architecture options across AWS/Azure, evaluate trade-offs, and define measurable KPIs for performance and reliability.',
  },
  {
    number: '03',
    title: 'PROTOTYPING',
    body: 'Rapid spikes and vertical slices — proof-of-concept APIs, ML model baselines, and UI shells — so risk is de-risked early and stakeholders can react to something real.',
  },
  {
    number: '04',
    title: 'DESIGN',
    body: 'System design and interface craft: clean service boundaries, typed contracts, and polished React experiences. Architecture diagrams meet production-ready component systems.',
  },
  {
    number: '05',
    title: 'ADAPTIVE',
    body: 'Responsive frontends, containerized services, CI/CD, and observability. Docker, Kubernetes, and GitHub Actions keep deployments consistent from laptop to cloud.',
  },
  {
    number: '06',
    title: 'THE FINAL',
    body: 'Hardening, load testing, documentation, and handoff. I ship with tests, monitoring hooks, and clear runbooks so the system stays healthy long after launch.',
  },
]

export default function Services() {
  const [openIdx, setOpenIdx] = useState(0)

  return (
    <section id="services" className="relative py-32">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          className="mb-16 text-center"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#00df8f]">
            Process
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tighter leading-[0.95] text-white sm:text-4xl md:text-5xl">
            STAGES OF WEBSITE
            <br />
            <span className="outline-text">DEVELOPMENT</span>
          </h2>
        </motion.div>

        <ul className="divide-y divide-white/10 border-y border-white/10">
          {stages.map((stage, index) => {
            const isOpen = openIdx === index
            return (
              <motion.li
                key={stage.number}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                transition={{ delay: index * 0.1, duration: 0.6 }}
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? -1 : index)}
                  className="flex w-full items-center gap-4 py-6 text-left transition-colors sm:gap-6 sm:py-7"
                  aria-expanded={isOpen}
                >
                  <span className="font-display text-sm font-semibold text-[#00df8f] sm:text-base">
                    {stage.number}
                  </span>
                  <span className="flex-1 font-display text-xl font-bold tracking-tighter text-white sm:text-2xl md:text-3xl">
                    {stage.title}
                  </span>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 text-white transition-colors hover:border-[#00df8f] hover:text-[#00df8f]">
                    {isOpen ? (
                      <Minus className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="max-w-2xl pb-7 pl-10 text-base leading-relaxed text-gray-400 sm:pl-14">
                        {stage.body}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
