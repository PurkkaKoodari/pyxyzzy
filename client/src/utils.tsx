import {useEffect, useRef, useState} from "react"
import { toast } from "react-toastify"

/**
 * A hook that returns an object whose `is` property is updated to indicate whether or not the component is mounted.
 * The reference to the returned object can be stored and used to avoid setState calls after the component has
 * unmounted.
 */
export const useMounted = () => {
  const mounted = useRef({ is: false }).current
  useEffect(() => {
    mounted.is = true
    return () => {
      mounted.is = false
    }
  }, [mounted])
  return mounted
}

// keep track of the largest seen scrollbar to account for scrollbars appearing on the page
let maxScrollbarWidth = 0

const getWindowWidth = () => {
  maxScrollbarWidth = Math.max(maxScrollbarWidth, window.innerWidth - document.documentElement.clientWidth)
  return window.innerWidth - 20
}

/**
 * A hook that returns the width of the viewport, reduced by the width of the largest scrollbar seen in the window.
 */
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

/**
 * Handles an unknown error.
 * @param error error description, currently unused
 */
export const unknownError = (error: any) => {
  toast.error("An unknown error occurred.")
}

/**
 * Wraps an async function to send all exceptions to {@link unknownError}.
 * @param action the async function to wrap
 */
export const handleAllErrorsAsUnknown = <A extends Array<any>, R>(action: (...args: A) => Promise<R>) => async (...args: A) => {
  try {
    return await action(...args)
  } catch (error) {
    unknownError(error)
    throw error
  }
}

let currentId = 1

/**
 * Returns an unique integer for each call during the lifetime of the app.
 */
export const uniqueId = (): number => (currentId++)

/**
 * Retuns an array of integers from `start` to `end-1`, or `0` to `start-1` if `end` is not given.
 * @param start start of the range, inclusive; assumed `0` if only one argument given
 * @param end end of the range, exclusive
 */
export const range = (start: number, end?: number) => {
  if (end === undefined)
    return Array.from(Array(start).keys())
  else
    return Array.from(Array(end - start), (_, i) => i + start)
}

/**
 * Provides non-reentrant mutual exclusion for critical sections in async code.
 */
export class Lock {
  private locked = false
  private waiting: (() => void)[] = []

  /**
   * Executes `asyncTask` with the guarantee that no other task is currently executing on this lock.
   * @param asyncTask the task to execute
   */
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

/**
 * Formats the given list of items as a list in English with commas and "and". This will eventually be replaced with a
 * proper localization system. If a `[singular, plural]` pair is given for `verb`, the correct form is appended to the
 * list.
 * @param items the items to format
 * @param verb the verb to append to the list, if any
 */
export const englishList = (items: string[], verb?: [string, string]) => {
  if (items.length === 1)
    return items[0] + (verb ? ` ${verb[0]}` : "")
  else
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1] + (verb ? ` ${verb[1]}` : "")
}

/**
 * Returns a promise that will be resolved after the given number of milliseconds.
 * @param millis the number of milliseconds to sleep
 */
export const sleep = async (millis: number) => {
  await new Promise<void>(resolve => setTimeout(() => resolve(), millis))
}
