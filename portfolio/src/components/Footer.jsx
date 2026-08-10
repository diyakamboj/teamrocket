import { motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'

const menuLinks = [
  { label: 'About', href: '#about' },
  { label: 'Work', href: '#work' },
  { label: 'Process', href: '#services' },
  { label: 'Contact', href: '#contact' },
]

const socials = [
  { label: 'Email', href: 'mailto:shaikfardeen595@gmail.com' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/' },
  { label: 'GitHub', href: 'https://github.com/' },
  { label: 'Phone', href: 'tel:+15712368595' },
]

export default function Footer() {
  const scrollTo = (href) => {
    if (href.startsWith('#')) {
      const el = document.querySelector(href)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <footer
      id="contact"
      className="relative overflow-hidden border-t border-white/10 pt-32 pb-10"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center overflow-hidden"
      >
        <span className="select-none font-display text-[25vw] font-bold leading-none tracking-tighter text-white opacity-5">
          CONTACT
        </span>
      </div>

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-10">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          >
            <h2 className="font-display text-3xl font-bold tracking-tighter text-white sm:text-4xl md:text-5xl">
              HOW CAN I HELP<span className="text-[#00df8f]">?</span>
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-gray-400">
              Open to full-stack, backend, cloud, and AI engineering roles.
              Based in Fairfax, VA — currently pursuing an M.S. in Computer
              Science at George Mason University.
            </p>
            <a
              href="mailto:shaikfardeen595@gmail.com"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-black transition-transform hover:scale-105"
            >
              shaikfardeen595@gmail.com
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.32, 0.72, 0, 1] }}
            className="grid grid-cols-2 gap-10"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                Menu
              </p>
              <ul className="mt-5 space-y-3">
                {menuLinks.map((link) => (
                  <li key={link.label}>
                    <button
                      type="button"
                      onClick={() => scrollTo(link.href)}
                      className="text-base text-gray-300 transition-colors hover:text-[#00df8f]"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                Socials
              </p>
              <ul className="mt-5 space-y-3">
                {socials.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.href.startsWith('http') ? '_blank' : undefined}
                      rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                      className="text-base text-gray-300 transition-colors hover:text-[#00df8f]"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>

        <div className="mt-24 flex flex-col gap-4 border-t border-white/10 pt-8 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Fardeen Portfolio. All rights reserved.</p>
          <div className="flex gap-6">
            <button type="button" className="hover:text-gray-300">
              Privacy
            </button>
            <button type="button" className="hover:text-gray-300">
              Terms
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
