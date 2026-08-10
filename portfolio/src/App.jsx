import Navbar from './components/Navbar'
import Hero from './components/Hero'
import About from './components/About'
import RecentWorks from './components/RecentWorks'
import Services from './components/Services'
import Footer from './components/Footer'

export default function App() {
  return (
    <div className="relative min-h-screen bg-[#0d1116] text-white font-sans">
      <Navbar />
      <main>
        <Hero />
        <About />
        <RecentWorks />
        <Services />
      </main>
      <Footer />
    </div>
  )
}
