import { motion } from 'framer-motion'

const skills = [
  'React.js',
  'Node.js',
  'TypeScript',
  'Python',
  'FastAPI',
  'Spring Boot',
  'AWS',
  'Azure',
  'Docker',
  'Kubernetes',
  'PostgreSQL',
  'MongoDB',
  'TensorFlow',
  'Framer Motion',
  'Tailwind CSS',
  'CI/CD',
]

const fadeUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
  transition: { duration: 0.6, ease: [0.32, 0.72, 0, 1] },
}

export default function About() {
  return (
    <section id="about" className="relative py-32">
      <div className="mx-auto grid max-w-7xl gap-16 px-5 sm:px-8 lg:grid-cols-2 lg:gap-20 lg:px-10">
        <motion.div {...fadeUp}>
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#00df8f]">
            About
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tighter leading-[0.95] text-white sm:text-4xl md:text-5xl lg:text-6xl">
            ENGINEERING
            <br />
            WITH PURPOSE<span className="text-[#00df8f]">.</span>
          </h2>

          <div className="mt-8 space-y-5 text-base leading-relaxed text-gray-400 sm:text-lg">
            <p>
              I&apos;m Mohammad Fardeen Shaik — an M.S. Computer Science student
              at George Mason University with a B.Tech from VIT. I build across
              the stack: cloud infrastructure, microservices, and AI systems
              that ship to production.
            </p>
            <p>
              From Stripe-powered MERN platforms serving 10,000+ users to NLP
              pipelines processing 150,000+ invoices at 98% accuracy, I care
              about measurable impact — clean APIs, automated DevOps, and
              models that hold up under real load.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-6 border-t border-white/10 pt-8">
            <div>
              <p className="font-display text-3xl font-bold tracking-tighter text-white sm:text-4xl">
                98%
              </p>
              <p className="mt-2 text-sm uppercase tracking-widest text-gray-400">
                Pipeline Accuracy
              </p>
            </div>
            <div className="border-l border-white/10 pl-6">
              <p className="font-display text-3xl font-bold tracking-tighter text-white sm:text-4xl">
                10K+
              </p>
              <p className="mt-2 text-sm uppercase tracking-widest text-gray-400">
                Active Users Shipped
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.32, 0.72, 0, 1] }}
          className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-md sm:p-10"
        >
          <h3 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
            My Toolkit
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-400">
            Languages, frameworks, and platforms I use to ship reliable systems.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {skills.map((skill, index) => (
              <motion.span
                key={skill}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ delay: index * 0.1, duration: 0.6 }}
                className="rounded-full border border-white/10 bg-[#14181f]/80 px-4 py-2 text-sm font-medium text-gray-300 transition-all duration-300 hover:border-[#00df8f] hover:text-[#00df8f] hover:shadow-[0_0_15px_rgba(0,223,143,0.3)]"
              >
                {skill}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
