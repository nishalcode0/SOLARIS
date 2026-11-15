import {
  Body,
  HelioVector,
  RotationAxis,
} from 'astronomy-engine'

import { writeFileSync } from 'node:fs'

const date = new Date()
const moonFromSun = HelioVector(Body.Moon, date)
const direction = {
  x: -moonFromSun.x,
  y: -moonFromSun.y,
  z: -moonFromSun.z,
}

const length = Math.hypot(direction.x, direction.y, direction.z)

const d = {
  x: direction.x / length,
  y: direction.y / length,
  z: direction.z / length,
}

const axis = RotationAxis(Body.Moon, date)

const rad = Math.PI / 180
const alpha = axis.ra * 15 * rad
const delta = axis.dec * rad
const spin = axis.spin * rad

const ca = Math.cos(alpha)
const sa = Math.sin(alpha)
const cd = Math.cos(delta)
const sd = Math.sin(delta)
const cs = Math.cos(spin)
const ss = Math.sin(spin)

const prime = { x: -sa, y: ca, z: 0 }
const east = {
  x: -sd * ca,
  y: -sd * sa,
  z: cd,
}
const pole = {
  x: cd * ca,
  y: cd * sa,
  z: sd,
}

const bodyX = {
  x: prime.x * cs + east.x * ss,
  y: prime.y * cs + east.y * ss,
  z: prime.z * cs + east.z * ss,
}

const bodyY = {
  x: -prime.x * ss + east.x * cs,
  y: -prime.y * ss + east.y * cs,
  z: -prime.z * ss + east.z * cs,
}

const sun = {
  x: d.x * bodyX.x + d.y * bodyX.y + d.z * bodyX.z,
  y: d.x * bodyY.x + d.y * bodyY.y + d.z * bodyY.z,
  z: d.x * pole.x + d.y * pole.y + d.z * pole.z,
}

const sunLength = Math.hypot(sun.x, sun.y, sun.z)

const result = {
  timestamp: date.toISOString(),
  sunMoonFixed: {
    x: sun.x / sunLength,
    y: sun.y / sunLength,
    z: sun.z / sunLength,
  },
}

writeFileSync(
  'public/data/solar-vector.json',
  JSON.stringify(result, null, 2),
)

console.log('Solar vector generated:', result)
