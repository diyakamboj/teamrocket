import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X } from 'lucide-react'

const links = [
  { label: 'ABOUT', href: '#about' },
  { label: 'WORK', href: '#work' },
  { label: 'CONTACT', href: '#contact' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollTo = (href) => {
    setOpen(false)
    if (href === '#top') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const el = document.querySelector(href)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
      className={`fixed top-0 left-0 z-50 w-full transition-colors duration-300 ${
        scrolled ? 'bg-[#0f1115]/90 shadow-[0_8px_30px_rgba(0,0,0,0.35)]' : 'bg-[#0f1115]/80'
      } backdrop-blur-md`}
    >
      <nav className="mx-auto flex h-24 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
        <button
          type="button"
          onClick={() => scrollTo('#top')}
          className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl"
          aria-label="Scroll to top"
        >
          FARDEEN<span className="text-[#00df8f]">.</span>
        </button>

        <ul className="hidden items-center gap-10 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <button
                type="button"
                onClick={() => scrollTo(link.href)}
                className="text-sm font-semibold uppercase tracking-widest text-gray-300 transition-colors duration-300 hover:text-[#00df8f]"
              >
                {link.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-white md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={() => scrollTo('#contact')}
            className="group relative flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all duration-300 hover:border-[#00df8f]/50 hover:shadow-[0_0_20px_rgba(0,223,143,0.25)]"
            aria-label="Contact"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-[#00df8f] transition-transform duration-300 group-hover:scale-125" />
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden border-t border-white/10 bg-[#0f1115]/95 md:hidden"
          >
            <ul className="flex flex-col gap-1 px-5 py-4">
              {links.map((link) => (
                <li key={link.href}>
                  <button
                    type="button"
                    onClick={() => scrollTo(link.href)}
                    className="w-full py-3 text-left text-sm font-semibold uppercase tracking-widest text-gray-300 transition-colors hover:text-[#00df8f]"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
