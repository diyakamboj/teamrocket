import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'

const projects = [
  {
    id: 1,
    category: 'AI / NLP Pipeline',
    title: 'AI Contract Invoice Intelligence',
    description:
      'Scalable NLP pipelines with TensorFlow and Apache Airflow that extract invoice data from unstructured PDFs — 150,000+ invoices annually at 98% accuracy, cutting validation error rates by 60% across $500M+ transaction volume.',
    tags: ['Python', 'TensorFlow', 'Apache Airflow', 'NLP'],
    image:
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800&auto=format&fit=crop',
  },
  {
    id: 2,
    category: 'Full-Stack / ML',
    title: 'Retail Recommendation System',
    description:
      'FastAPI backend with versioned recommendation endpoints and a React/Tailwind analytics UI. Pure-Python SVD collaborative filtering, KMeans segmentation, and Apriori rule mining — minimal deploy footprint, maximum insight.',
    tags: ['FastAPI', 'React', 'SVD', 'KMeans'],
    image:
      'https://images.unsplash.com/photo-1542204165-65bf26472b9b?q=80&w=800&auto=format&fit=crop',
  },
  {
    id: 3,
    category: 'ML / Signal Processing',
    title: 'Infant Cry & Autism Detection',
    description:
      'Cry classifier at 92% accuracy across 10,000+ audio samples, plus an autism detection pipeline on 3,000+ subjects — cutting caregiver response latency by 35% and diagnostic processing time by 40%.',
    tags: ['TensorFlow', 'Scikit-learn', 'Signal Processing'],
    image:
      'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=800&auto=format&fit=crop',
  },
  {
    id: 4,
    category: 'Research / Published',
    title: "Parkinson's Disease Prediction",
    description:
      'Published at Springer ICMEET 2024. Random Forest + SVM on the Oxford dataset achieving 92–98% accuracy with custom SQL views that sped data prep by 30–50%, outperforming prior baselines on sensitivity and specificity.',
    tags: ['Python', 'SQL', 'Random Forest', 'SVM'],
    image:
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=800&auto=format&fit=crop',
  },
]

const ease = [0.32, 0.72, 0, 1]

export default function RecentWorks() {
  const [activeIdx, setActiveIdx] = useState(0)
  const active = projects[activeIdx]

  const bringToFront = (idx) => {
    if (idx === activeIdx) {
      setActiveIdx((prev) => (prev + 1) % projects.length)
    } else {
      setActiveIdx(idx)
    }
  }

  return (
    <section id="work" className="relative py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, ease }}
          className="mb-16 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#00df8f]">
              Portfolio
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tighter text-white sm:text-4xl md:text-5xl lg:text-6xl">
              RECENT WORKS
            </h2>
          </div>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-gray-300 transition-all hover:border-[#00df8f] hover:text-[#00df8f]"
          >
            View All Projects
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </motion.div>

        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Stack */}
          <div className="lg:col-span-7">
            <div
              className="relative h-[340px] w-full sm:h-[450px] md:h-[480px]"
              style={{ perspective: '1200px' }}
            >
              {projects.map((project, idx) => {
                const diff =
                  (idx - activeIdx + projects.length) % projects.length
                const isActive = diff === 0

                return (
                  <motion.button
                    key={project.id}
                    type="button"
                    onClick={() => bringToFront(idx)}
                    initial={false}
                    animate={{
                      y: diff * 35,
                      scale: 1 - diff * 0.05,
                      rotateX: diff * 2,
                      zIndex: projects.length - diff,
                      opacity: diff > 3 ? 0 : 1,
                    }}
                    transition={{ duration: 0.65, ease }}
                    className="absolute inset-x-0 top-0 mx-auto w-full max-w-xl origin-top overflow-hidden rounded-2xl border border-white/10 bg-[#14181f] text-left shadow-[0_20px_60px_rgba(0,0,0,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00df8f]"
                    style={{ transformStyle: 'preserve-3d' }}
                    aria-label={`Show project: ${project.title}`}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden">
                      <img
                        src={project.image}
                        alt={project.title}
                        className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
                        draggable={false}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0d1116]/70 via-transparent to-transparent" />
                      {isActive && (
                        <span className="absolute bottom-4 left-4 rounded-full bg-[#00df8f] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#0d1116]">
                          Active
                        </span>
                      )}
                    </div>
                  </motion.button>
                )
              })}
            </div>

            {/* Dots */}
            <div className="mt-6 flex items-center justify-center gap-2.5">
              {projects.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  aria-label={`Go to ${p.title}`}
                  className={`h-2.5 rounded-full transition-all duration-300 ${
                    idx === activeIdx
                      ? 'w-8 bg-[#00df8f]'
                      : 'w-2.5 bg-white/20 hover:bg-white/40'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Details */}
          <div className="flex flex-col items-start lg:col-span-5 lg:pt-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.4, ease }}
                className="w-full"
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-[#00df8f]">
                  {active.category}
                </p>
                <h3 className="mt-4 font-display text-2xl font-bold tracking-tighter text-white sm:text-3xl md:text-4xl">
                  {active.title}
                </h3>
                <p className="mt-5 text-base leading-relaxed text-gray-400">
                  {active.description}
                </p>

                <div className="mt-6 flex flex-wrap gap-2">
                  {active.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-gray-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <a
                  href="#contact"
                  className="mt-8 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#00df8f] to-[#00b373] px-6 py-3 text-sm font-semibold text-white transition-transform hover:scale-105"
                >
                  Explore Project
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
