import { createRoot } from 'react-dom/client'

function Boot() {
  return <div id="boot">Terminal3000</div>
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Boot />)
