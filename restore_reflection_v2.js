// Paste this entire script into the browser console to restore reflection answers.
(async () => {
  const ANSWERS = {
    'operating systems': [
      "'Includes' implies OS owns processes as a subsystem. 'Manages' or 'creates' would downplay ownership. The edge should convey that the OS is responsible for full lifecycle (fork/exec/terminate), resource allocation (memory, FDs, CPU time), and protection. Process boundary = unit of isolation.",
      "OS 'includes' Thread understates that the OS is responsible for thread lifecycle (clone() on Linux), scheduling, and synchronization primitives (futexes). The edge should really be 'OS manages Thread lifecycle' rather than structural containment.",
      "Placing Scheduler under OS as 'includes' makes it feel like a peer-level service. Better: Scheduler → Context Switch: triggers (directed) to show causality. The OS owns the Scheduler which owns the mechanism.",
      "Context Switch being 'included by' OS hides that it's triggered by Scheduler. Better structure: Scheduler → Context Switch: triggers, Context Switch → Thread: saves/restores state of. Missing: CPU node connected to Context Switch to show TLB/register effects.",
      "OS 'includes' Synchronization is directionally wrong—OS provides kernel-level primitives (futexes, semaphores), but synchronization as a concept is broader. Some sync (spinlocks, atomics) needs no OS involvement. Better: OS → Synchronization: provides primitives.",
    ],
    'process': [
      "Process boundary gives address space (page tables mapped to physical memory), open FDs, credentials, signal handlers, resource limits. Thread only adds stack + registers + TID. 'Contains' is right: threads can't exist outside a process—they borrow the address space. Destroying process destroys all threads; destroying one thread leaves others intact.",
      "On Linux the scheduler selects kernel threads (tasks), not whole processes. A process with 8 threads gets 8 chances to be scheduled. Thread-level scheduling gives true parallelism across cores. Should add: Scheduler → Thread: selects (directed), with note that threads within a process compete independently.",
      "When CPU switches between processes, it writes CR3 (page table root), flushing TLB. TLB misses cause every virtual address to need a full page-table walk. Cache also thrashed. Thread switch within same process avoids this—same page tables, caches stay warm. Need: Context Switch → CPU: writes CR3 on process boundary.",
      "OS 'includes' Process should convey full lifecycle management, resource allocation, protection. Missing intermediate concepts: Process Table (kernel data structure tracking live processes), IPC (processes need OS to communicate via pipes/sockets/shared memory), Resource Limits (ulimit/cgroups between OS and Process).",
    ],
    'thread': [
      "All threads share: virtual address space (page tables), heap, code/data segments, open FDs, signal handlers, credentials. Per-thread: stack, program counter, register file, TLS. The 'contains' edge doesn't capture this—need a note on Thread listing private state. Most important: threads share the heap, which is why they need synchronization.",
      "OS is responsible for: creating kernel threads (clone()), scheduling (each kernel thread is a schedulable entity), destroying and reclaiming stacks, providing sync primitives (futexes), delivering signals. Should add: Thread → Scheduler: scheduled by (directed) and Thread → Synchronization: uses.",
      "If threads had separate address spaces like processes, they couldn't directly share a heap pointer. Sharing would require explicit IPC (pipes, shared memory via mmap). Synchronization wouldn't disappear but would shift from protecting heap structures to protecting shared memory regions. The need for sync comes FROM sharing an address space.",
      "On Linux the scheduler's unit is the task (kernel thread), not the process. Two threads in same process can run simultaneously on different cores. Thread switch is cheaper: same page tables, no CR3 swap, no TLB flush. Should add: Thread → Scheduler: scheduled by, Thread → Context Switch: triggers (noting cheaper within same-process).",
    ],
    'scheduler': [
      "Scheduler → Process: selects is technically wrong for Linux—scheduler selects kernel threads. A multi-threaded process contributes N candidates to run queue. Should change to Scheduler → Thread: selects, or add it alongside. Process edge could note 'single-threaded case only'.",
      "Scheduler decides WHEN to switch (policy), context switch is the MECHANISM: save registers, switch kernel stack, swap CR3 if cross-process, restore registers. 'Coordinates' captures causality but hides who pays TLB/cache cost. Should add: Context Switch → CPU: modifies TLB/register state.",
      "Scheduler → Scheduling Policy: uses (not the other way). Policy is a plugin/parameter telling Scheduler HOW to pick (CFS, FIFO, RT). Should add: Scheduling Policy node, Run Queue node (per-CPU data structure), CPU node with Scheduler → CPU: dispatches thread to.",
      "When a thread fails to acquire a lock, it calls into OS (futex), Scheduler blocks it (removes from run queue), context switch happens. Lock release → OS wakes blocked thread → scheduler puts it back on run queue → potential context switch. Should add: Synchronization → Scheduler: blocks/wakes threads (directed).",
    ],
    'context switch': [
      "Context Switch should NOT be 'included by' OS as a peer. It's invoked by Scheduler and acts on Thread state. Better: remove OS→Context Switch, add Scheduler → Context Switch: triggers and Context Switch → Thread: saves/restores state of.",
      "Hardware does little automatically: on interrupt, CPU pushes IP/SP/flags to kernel stack, jumps to handler. Everything else is OS code: save GPRs, run scheduler, load new thread's registers. Should add: Timer Interrupt node → Scheduler: triggers preemption. CR3 write is privileged instruction OS issues.",
      "Scheduler has two roles: policy (CFS picks next thread) and dispatcher (calls switch_to()). Better edge labels: Scheduler → Context Switch: triggers (not 'coordinates'). Should split: Scheduling Policy → Scheduler: informs, Scheduler → Context Switch: triggers.",
      "Longer time slices → fewer switches → less overhead, worse interactive latency. Shorter → more switches → better responsiveness, worse throughput. Should add: Scheduling Policy → Context Switch: determines frequency, Scheduling Policy → Time Slice node, Time Slice affecting Latency and Throughput.",
      "TLB is most expensive: CR3 write flushes TLB (unless PCID). L1/L2 caches polluted by new thread's working set. Branch predictor history tables corrupted. Should add: ASID/PCID node → Context Switch: mitigates TLB flush cost. TLB Shootdown node for multicore. Cache miss penalty ~1000 cycles after switch.",
    ],
    'synchronization': [
      "Synchronization as concept is broader than OS—applies to hardware (memory barriers), user-space libraries (C++ mutex), distributed systems. OS doesn't 'include' it; it provides specific primitives. Better: OS → Synchronization: provides primitives (directed). Some sync (atomics, spinlocks) needs no OS involvement.",
      "Lock and Semaphore are distinct primitives at different abstraction levels, not just 'implementations' of the same thing. Semaphore has counter+wait/signal semantics. Lock has binary ownership. 'Implemented by' implies they're concrete versions of an interface—not accurate. Better: Semaphore → Synchronization: realizes, Lock → Synchronization: realizes.",
      "Use Lock when: exactly one thread should access at a time, ownership matters (acquirer must release). Use Semaphore when: controlling access to a pool of N resources, or signaling across threads (producer signals consumer). Key difference: mutex enforces single-thread ownership; semaphore is a counter with no ownership semantics.",
      "Condition variable is the most important missing node—completes the mutex pattern (wait for state change, atomically release mutex). Atomic Operation belongs as hardware-level sync without OS involvement (LOCK XCHG, CMPXCHG): Lock → Atomic Operation: built on, Atomic Operation → CPU: implemented by. Thread → Synchronization: requires closes the loop.",
    ],
    'cpu': [
      "'Occurs on' makes CPU look like a passive surface. Real initiator is Scheduler (or timer interrupt). Better: Scheduler → Context Switch: triggers (who decides), Context Switch → CPU: executes on (where work happens). 'Occurs on' also hides that some context switch work happens in kernel memory, not just CPU registers.",
      "CPU runs Thread is more accurate—the CPU doesn't schedule processes, it runs instructions from whatever thread the scheduler put on it. A process with 4 threads can have all 4 running on 4 cores simultaneously. Should add: CPU → Thread: executes (directed). Process connection should be: CPU → Process: executes within address space of.",
      "Every process switch writes CR3, flushing TLB (or invalidating ASID-tagged entries with PCID). L1/L2 data and instruction caches are polluted. Branch predictor history corrupted. Result: cold-start penalty of ~1000-10000 cycles. Should add: CPU → TLB node with 'contains address translations', Context Switch → TLB: flushes on process switch, Context Switch → Cache: pollutes working set.",
      "'Occurs on' collapses two different operations. Register save/restore is software (OS saves/loads GPRs). Address-space change is hardware (writing CR3, MMU picks it up, TLB invalidated). Different costs, actors, consequences. Better: Context Switch → Thread: saves/restores register state, Context Switch → CPU: writes CR3 on process boundary.",
    ],
    'shared resource': [
      "Thread link is more precise: threads in same process share heap and can directly read/write same memory address—no OS mediation. Process sharing requires explicit OS-mediated mechanisms (shared memory via mmap/shmget, pipes, sockets). Should add both but with different labels: Thread → Shared Resource: accesses directly vs Process → Shared Resource: accesses via IPC.",
      "'Protects' doesn't distinguish HOW. Mutex: one thread at a time, ownership enforced, fine-grained. Semaphore: N threads at a time, no ownership, resource pool. Reader-writer lock: multiple concurrent readers, exclusive writers. Should add: Lock → Shared Resource: guards, Semaphore → Shared Resource: limits concurrent access to.",
      "Without sync, two threads interleave reads/writes freely—race condition, nondeterministic final state (lost updates, torn reads). Should add: Race Condition node → Shared Resource: results from unprotected access, Synchronization: prevents. Also Invariant node: condition that must hold across all accesses, Synchronization: enforces.",
      "Thread access: same virtual address space, ptr means same physical memory to both, no OS involvement, implicit sharing. Process access: OS must explicitly map same physical pages into both (shm_open/mmap), opt-in and auditable. Should show: Thread → Shared Resource (implicit) vs Process → IPC → Shared Resource (explicit OS-mediated).",
    ],
    'scheduling policy': [
      "Context switch cost sets a floor on minimum useful time slice. If switch costs ~1-5µs plus cache warm-up (~10-50µs), a 10µs time slice spends more time switching than doing work. CFS uses ~6ms target latency divided by runnable threads to balance fairness vs cache warmth. Policy can't be designed in isolation from switch cost.",
      "Throughput would collapse. Cache miss rates permanently elevated—no thread runs long enough to amortize cold-start penalty. TLB flushes continuously (cross-process). CPU execution units wait for memory rather than computing. Latency gets worse too: cache thrashing means each task takes longer per quantum. Pathological case: 100 threads, 10µs quantum, 9µs spent recovering from cold start.",
      "Scheduler should link TO Scheduling Policy, not the other way. Scheduler is mechanism (picks next thread, calls dispatcher, updates run queues). Policy is plugin telling scheduler HOW to pick (FIFO, CFS, RT). Like Linux sched_class: each class implements fixed interface, Scheduler delegates 'who's next' decision to it. Edge: Scheduler → Scheduling Policy: uses.",
      "Yes—policy choices directly predict microarchitectural behavior. Short quanta + many process switches → high TLB pressure, cache thrashing. Thread affinity (pin thread to same core) → warm caches, fewer TLB misses. NUMA-aware scheduling → reduced memory latency. Should add: Scheduling Policy → CPU: affects TLB/cache locality. Closes missing loop: policy controls HOW OFTEN context switch damage happens.",
    ],
    'cpu microarchitectural state': [
      "Timer interrupt → pipeline flush (in-flight instructions squashed). Scheduler runs → pollutes instruction cache + branch predictor with scheduler code. CR3 write (process switch only) → full TLB flush, every subsequent VA needs page-table walk. New thread's code → L1/L2 instruction cache cold. New thread's data access → data cache cold. Branch predictor → misprediction storm from mismatched history.",
      "Same-process thread switch: CR3 NOT written, TLB remains valid, some cache lines useful to both threads, branch predictor still confused. Cross-process: all of above + TLB flush + both instruction and data caches cold from scratch. Real cost difference: same-process ~1-3µs, cross-process ~5-20µs depending on working set and PCID support.",
      "Yes, should add Scheduler → CPU Microarchitectural State: influences via affinity. Strategies: CPU affinity (run thread on same core → L1/L2 warm, TLB valid), cache-aware grouping, NUMA-aware placement. Linux's sched_domain hierarchy is entirely about this. Current graph implies scheduler is indifferent to hardware state—understates how much scheduling code is about cache locality.",
      "Missing: Process → CPU Microarchitectural State: defines TLB scope (process switch invalidates TLB). Thread → CPU Microarchitectural State: builds working set in cache (thread's access pattern determines cache warmth). Thread → CPU Microarchitectural State: trains branch predictor. Currently CPU Microarchitectural State is a leaf that Context Switch damages, but no path shows Process/Thread as SOURCES of microarchitectural state.",
    ],
    'semaphore': [
      "One edge hides two different roles. Binary semaphore (init=1): acts like mutex for mutual exclusion but no ownership enforcement. Counting semaphore (init=N): limits concurrent access to N slots. Should add: Semaphore → Shared Resource: limits concurrent access to. Note: semaphore has no ownership—any thread can signal regardless of who waited.",
      "Lock: strong ownership, acquirer must release, binary (0/1), OS can do priority inheritance. Semaphore: no ownership (any thread can signal), counter (0 to N), no priority inheritance possible. Use Lock for critical sections; use Semaphore for signaling across threads or throttling resource pools. Should annotate: Lock → Thread: acquired/released by same thread, Semaphore → Thread: signaled by any thread.",
      "When thread calls sem_wait on zero-valued semaphore, it blocks—OS removes from run queue (via futex), context switch happens. sem_signal → OS wakes blocked thread → puts back on run queue → potential context switch. Semaphore-induced blocking IS a scheduling event. Should add: Semaphore → Scheduler: triggers block/wake (directed). Explains why contended semaphores are expensive.",
      "Atomic Operations: yes, add it. Every sem_wait/signal must atomically decrement/increment counter. On x86: LOCK XADD or CMPXCHG. Without atomics, two threads could both see nonzero and both proceed. Should add: Semaphore → Atomic Operations: requires, Atomic Operations → CPU: implemented by. Fairness/Queueing: body note on Semaphore is sufficient—'maintains FIFO wait queue'.",
    ],
    'lock': [
      "Lock captures mutual exclusion: one thread at a time, ownership enforced, binary locked/unlocked state, protected data consistent when unlocked. Doesn't address: signaling across threads (need condition variable), counting access (need semaphore or RW-lock), coordination without exclusion (atomics). Also 'implemented by' direction is wrong—Lock realizes Synchronization, not the other way.",
      "Lock ownership: same thread acquires and releases. Semaphore ownership: none—any thread can signal. Lock: binary (0/1). Semaphore: counter (0 to N). Lock enables priority inheritance (OS knows holder). Semaphore can't (no owner). Should annotate: Lock → Thread: acquired/released by same thread vs Semaphore → Thread: signaled by any thread. Lock for critical sections; semaphore for signaling/pools.",
      "Lock → Thread: acquired by (directed) makes ownership explicit—enables deadlock analysis (thread A holds lock 1, waits lock 2; thread B holds lock 2, waits lock 1 → cycle). Without this edge, graph can't represent deadlock structurally. Lock → Shared Resource: protects (directed) shows purpose. Currently Synchronization → Shared Resource does this at wrong abstraction level.",
      "Contended sleeping mutex: thread calls into OS (futex), OS blocks it (removes from run queue), context switch. On release: futex_wake, OS puts thread back on run queue, potential context switch. Cost: 2 context switches per contention event with all TLB/cache damage. Should add: Lock → Scheduler: triggers block/wake on contention. Spinlock variant has no scheduler edge but wastes CPU cycles. Both deserve notes distinguishing 'park thread' vs 'spin' paths.",
    ],
  };

  const nodes = await fetch('http://localhost:8000/nodes').then(r => r.json());
  const result = {};
  const matched = [], unmatched = [];

  for (const n of nodes) {
    const key = n.title.toLowerCase();
    if (ANSWERS[key]) {
      result[n.id] = ANSWERS[key];
      matched.push(n.title);
    } else {
      unmatched.push(n.title);
    }
  }

  localStorage.setItem('reflection_answers', JSON.stringify(result));
  console.log('✓ Restored answers for:', matched);
  if (unmatched.length) console.warn('✗ No answers for:', unmatched);
  console.log(`Done: ${matched.length} matched, ${unmatched.length} unmatched`);
})();
