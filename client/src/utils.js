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

export const unknownError = (error) => {
    toast.error("An unknown error occurred.")
}

let currentId = 1

export const uniqueId = () => (currentId++)

export const range = (start, end) => {
    if (typeof end === "undefined")
        return Array.from(Array(start).keys())
    else
        return Array.from(Array(end - start), (_, i) => i + start)
}

export class Lock {
    constructor() {
        this.locked = false
        this.waiting = []
    }

    async acquire(asyncTask) {
        if (this.locked)
            await new Promise(resolve => this.waiting.push(resolve))
        this.locked = true
        try {
            return await asyncTask()
        } finally {
            this.locked = false
            if (this.waiting.length)
                this.waiting.shift()()
        }
    }
}
