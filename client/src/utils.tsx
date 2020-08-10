import { useEffect, useRef } from "react"
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

export const unknownError = (error: string) => {
    toast.error("An unknown error occurred.")
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
