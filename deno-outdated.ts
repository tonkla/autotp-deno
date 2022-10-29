const deps = await Deno.readTextFile('deps.ts')

const regexPkg = /(https:\/\/.+)@([^\/]+)/

let isFinding = true

Deno.stdout.write(new TextEncoder().encode('.'))
const id = setInterval(() => {
  if (isFinding) Deno.stdout.write(new TextEncoder().encode('.'))
}, 250)

const packages: { [key: string]: { name: string; version: string } } = {}
for (const line of deps.split('\n')) {
  const pkg = line.match(regexPkg)
  if (!pkg) continue
  const key = pkg[0]
  const name = pkg[1]
  const version = pkg[2]
  packages[key] = { name, version }
}

const outdated: string[][] = []
for (const pkg of Object.values(packages)) {
  const res = await fetch(pkg.name)
  const latest = res.url.split('@')[1]
  if (pkg.version !== latest) {
    outdated.push([pkg.name, pkg.version, latest])
  }
}

isFinding = false
clearInterval(id)
console.info('\n')
if (outdated.length > 0) {
  for (const pkg of outdated) {
    console.info(pkg[0], ' ⟹ ', { current: pkg[1], latest: pkg[2] })
  }
} else {
  console.info('All packages are updated.')
}
