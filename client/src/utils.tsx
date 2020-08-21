import {useEffect, useRef, useState} from "react"
import { toast } from "react-toastify"

export const useMounted = () => {
  const mounted = useRef({ is: false }).current
  useEffect(() => {
    mounted.is = true
    return () => {
      mounted.is = false
    }
  }, [])
  return mounted
}

// keep track of the largest seen scrollbar to account for scrollbars appearing on the page
let maxScrollbarWidth = 0

const getWindowWidth = () => {
  maxScrollbarWidth = Math.max(maxScrollbarWidth, window.innerWidth - document.documentElement.clientWidth)
  return window.innerWidth - 20
}

export const useWindowWidth = () => {
  const [windowWidth, setWindowWidth] = useState(getWindowWidth())

  useEffect(() => {
    const listener = () => {
      setWindowWidth(getWindowWidth())
    }
    window.addEventListener("resize", listener)
    return () => {
      window.removeEventListener("resize", listener)
    }
  }, [])

  return windowWidth
}

export const unknownError = (error: string) => {
  toast.error("An unknown error occurred.")
}

export const handleAllErrorsAsUnknown = <A extends Array<any>, R>(action: (...args: A) => Promise<R>) => async (...args: A) => {
  try {
    return await action(...args)
  } catch (error) {
    unknownError(error)
  }
}

let currentId = 1

export const uniqueId = (): number => (currentId++)

export const range = (start: number, end?: number) => {
  if (end === undefined)
    return Array.from(Array(start).keys())
  else
    return Array.from(Array(end - start), (_, i) => i + start)
}

export class Lock {
  locked = false
  waiting: (() => void)[] = []

  async acquire<T>(asyncTask: () => PromiseLike<T>) {
    if (this.locked)
      await new Promise<void>(resolve => this.waiting.push(resolve))
    this.locked = true
    try {
      return await asyncTask()
    } finally {
      this.locked = false
      if (this.waiting.length)
        this.waiting.shift()!()
    }
  }
}

export const englishList = (items: string[], verb?: [string, string]) => {
  if (items.length === 1)
    return items[0] + (verb ? ` ${verb[0]}` : "")
  else
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1] + (verb ? ` ${verb[1]}` : "")
}

export const sleep = async (millis: number) => {
  await new Promise(resolve => setTimeout(() => resolve(), millis))
}
