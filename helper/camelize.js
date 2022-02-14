// Credit: https://matthiashager.com/converting-snake-case-to-camel-case-object-keys-with-javascript

function toCamel(s) {
  return s.replace(/([-_][a-z])/gi, ($1) => {
    return $1.toUpperCase().replace('-', '').replace('_', '')
  })
}

const isObject = function (o) {
  return o === Object(o) && !Array.isArray(o) && typeof o !== 'function' && !(o instanceof Date)
}

export function camelize(o) {
  if (isObject(o)) {
    const n = {}
    Object.keys(o).forEach((k) => {
      n[toCamel(k)] = camelize(o[k])
    })
    return n
  } else if (Array.isArray(o)) {
    return o.map((i) => camelize(i))
  }
  return o
}
