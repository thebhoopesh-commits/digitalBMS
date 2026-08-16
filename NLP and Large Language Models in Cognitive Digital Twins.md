# NLP and Large Language Models in Cognitive Digital Twins

## Deep Technical Research and Analysis

**Prepared by:** Manus AI  
**Date:** 14 August 2026  
**Scope:** Cognitive Digital Twins (CDTs), agentic digital twins, and the integration of NLP/LLMs with industrial, healthcare, supply-chain, and smart-city systems.

## Executive Summary

A **Cognitive Digital Twin (CDT)** is best understood not as a digital replica with a chatbot attached, but as a digitally connected system that maintains a live state representation, reasons over structured and unstructured evidence, simulates possible actions, explains its conclusions, and—within carefully bounded authority—initiates or recommends changes to the physical system. The underlying digital-twin pattern remains the triplet of a physical system, a virtual model, and a communication link; newer intelligent or cognitive twins add learning, reasoning, knowledge, autonomy, and interaction capabilities.[1] [2]

Large language models can improve digital twins primarily at the **semantic and orchestration layers**. They can translate natural-language questions into queries, retrieve relevant maintenance and engineering knowledge, interpret documents and operator notes, coordinate specialized tools or agents, generate explanations, and turn simulation results into actionable narratives. They do not replace first-principles models, time-series forecasting, optimization solvers, safety PLCs, or clinical validation. The sound architecture is therefore **hybrid**: the LLM proposes, retrieves, explains, and coordinates; typed tools, digital-twin state stores, simulators, rules, and human approvals constrain what can be executed.

The technology is moving from research toward usable platforms. NVIDIA Omniverse provides accelerated libraries and microservices for physical-AI simulation and agentic workflows.[3] Google’s Agent Development Kit supports tool-using agents, multi-agent orchestration, graph workflows, evaluation, and deployment.[4] Eclipse BaSyx implements Asset Administration Shell-based twins and live exchange over industrial protocols such as OPC UA and MQTT.[5] Siemens markets Industrial Copilots for workflows spanning design, planning, operations, service, troubleshooting, and code generation.[6] These platforms demonstrate a growing ecosystem, but not a single standardized CDT stack.

The strongest near-term applications are **decision support and scenario analysis**, especially in manufacturing maintenance, engineering documentation, supply-chain control towers, and operational planning. High-consequence autonomous actuation remains premature in most environments. The principal barriers are semantic interoperability, incomplete and stale data, latency, model drift, hallucination, cyber-physical attack surface, privacy, unclear accountability, and the difficulty of validating a probabilistic language model inside a deterministic or safety-critical control loop.

> **Bottom line:** Build the CDT as a governed operational system with an LLM interface—not as an LLM that happens to know about a physical system.

## 1. Scope and Foundations

### 1.1 From traditional digital twins to cognitive twins

A traditional digital twin couples a physical asset or process to a virtual representation through a data connection. Its capabilities may include monitoring, anomaly detection, simulation, prediction, and optimization. A cognitive twin adds a semantic and decision layer that can interpret human language, connect heterogeneous evidence, reason over relationships, select tools, explain outcomes, and coordinate with people or other twins. The evolution can be summarized as follows.

| Twin generation | Core capability | Typical interaction | Main limitation |
|---|---|---|---|
| Static or replica twin | Stores geometry, identity, specifications, or fixed state | Dashboards and reports | Does not represent live behavior |
| Functional or mirror twin | Simulates behavior and supports analysis | Engineers query models and visualizations | Often requires expert-authored models |
| Self-adaptive or shadow twin | Ingests live data and updates state | Alerts, predictions, closed-loop analytics | Data integration and model maintenance are difficult |
| Intelligent or cognitive twin | Learns, reasons, explains, plans, and may act | Natural language, multimodal interfaces, agents | Safety, validation, accountability, and security are unresolved |

The terms **cognitive digital twin**, **intelligent digital twin**, and **agentic digital twin** are related but not identical. “Cognitive” emphasizes perception, knowledge, reasoning, and decision-making. “Agentic” emphasizes the ability to pursue goals by selecting actions through tools, workflows, and interaction with other agents. A system can be cognitive without being autonomous, and agentic without being safe or genuinely model-based.

The key shift caused by NLP and LLMs is not that the twin becomes “intelligent” merely by generating fluent text. Rather, language becomes a **semantic control plane** over the twin. An operator can ask, “Why did line 4 lose throughput after the tool change, and what happens if we move the preventive-maintenance window to Saturday?” The system should translate that request into structured queries, retrieve relevant context, invoke a calibrated simulator or optimizer, compare scenarios, and cite the data and assumptions behind the answer.

### 1.2 The hybrid CDT architecture

A practical CDT requires at least six layers: physical connectivity, state and model management, semantic knowledge, reasoning and retrieval, simulation and optimization, and governance/action. The following flowchart represents the recommended design.

```text
[Physical assets, people, environment]
          |
          v
[IoT / PLC / SCADA / EHR / ERP / video / documents]
          |
          v
[Streaming and data-quality layer]
  OPC UA | MQTT | Kafka | FHIR | REST | batch ETL
          |
          +----------------------------+
          |                            |
          v                            v
[Live twin state store]        [Historical lakehouse]
 time series, events,         telemetry, labels, reports,
 topology, identity            maintenance and outcomes
          |                            |
          +-------------+--------------+
                        v
[Semantic layer]
 Asset Administration Shells | ontologies | knowledge graph
 entity resolution | provenance | permissions | versioning
                        |
            +-----------+-----------+
            |                       |
            v                       v
[Retrieval and context]       [Executable models]
 vector search / GraphRAG     physics, ML, discrete-event,
 documents / policies         optimization, rules, constraints
            |                       |
            +-----------+-----------+
                        v
[LLM / multimodal agent layer]
 intent parsing | tool selection | planning | explanation
 vision-language inputs | specialized agents | uncertainty
                        |
                        v
[Safety and governance gateway]
 schema validation | policy checks | simulation first | approval
 rate limits | audit log | rollback | human override
                        |
              +---------+---------+
              |                   |
              v                   v
       [Recommendation]     [Bounded actuation]
       dashboard / report    MES / CMMS / robot / control API
              ^                   |
              +------ feedback ---+
```

The **semantic layer** is the architectural center of gravity. A knowledge graph represents assets, components, locations, dependencies, operating states, events, and causal or temporal relations. Retrieval-augmented generation (RAG) supplies manuals, work orders, standards, policies, and recent events. GraphRAG combines graph traversal with document retrieval, which is useful when an answer depends on both a relational path—such as pump → bearing → maintenance order—and a textual source such as a service bulletin.

The Asset Administration Shell (AAS) is a strong industrial interoperability candidate because it provides standardized descriptions, interfaces, and submodels for assets. Eclipse BaSyx reports support for AAS registries, submodel servers, live data, and integration with OPC UA and MQTT.[5] An LLM can help transform vendor-specific documentation into AAS structures, but the generated model must be validated. An IEEE Access case study on LLM-generated AAS models reported a 62–79% effective generation rate under human evaluation, demonstrating productivity potential while also showing why automatic acceptance is unsafe.[7]

### 1.3 Bidirectional data is necessary but not sufficient

A one-way dashboard is not a full cognitive twin. The twin must receive observations from the physical world and return decisions, setpoints, work orders, or human-facing recommendations. Bidirectionality introduces a much larger risk surface. The action pathway must therefore be typed and constrained. For example, an LLM should not emit arbitrary PLC commands; it should call a tool such as `schedule_maintenance(asset_id, window, justification)` whose arguments are schema-validated and whose execution is subject to authorization, simulation, and approval rules.

## 2. Current Market and Research Landscape

### 2.1 Platform landscape

The market is converging around complementary platform categories rather than one end-to-end CDT product.

| Category | Representative technologies | Strength | CDT role | Gap |
|---|---|---|---|---|
| 3D and physical simulation | NVIDIA Omniverse, OpenUSD, robotics simulators | High-fidelity spatial and physical simulation | Virtual environment, scenario testing, synthetic data | Does not by itself supply enterprise semantics or governance |
| Industrial twin middleware | Eclipse BaSyx, AAS ecosystem, OPC UA, MQTT | Interoperability and live asset data | Identity, state, interfaces, submodels | Requires domain modeling and integration work |
| Agent frameworks | Google ADK and similar tool/graph frameworks | Agent orchestration, tools, evaluation, deployment | Planning, delegation, multi-agent workflows | Not a physical model, historian, or safety system |
| Enterprise industrial suites | Siemens Industrial Copilot, PLM/MES/SCADA ecosystems | Existing operational data and workflows | Human-facing assistance and action integration | Vendor-specific architecture and variable evidence of autonomy |
| Cloud twin services | IoT, time-series, graph, data-lake, and AI services | Elastic infrastructure and analytics | Ingestion, storage, retrieval, deployment | Integration, latency, cost, and lock-in |
| Research frameworks | CALM-DT, LLM-to-AAS, RAG/GraphRAG prototypes | New adaptation and semantic techniques | Testbeds for continuous adaptation and interoperability | Limited physical validation and production evidence |

NVIDIA describes Omniverse as accelerated libraries and microservices for physical-AI simulation applications and agentic workflows, with SDKs, APIs, OpenUSD, and blueprints.[3] This makes it a compelling spatial and simulation substrate for factory layouts, robotics, warehouse operations, and infrastructure. Google ADK describes a progression from prompts and tool calls to multi-agent orchestration, graph workflows, evaluation, and enterprise deployment.[4] It is therefore suitable for the agent-control layer, not as a replacement for the twin’s state and simulation layers.

The distinction matters commercially. A platform may advertise “digital twins” while providing only visualization, or advertise “agents” while lacking a verified operational model. Procurement should evaluate the complete path from sensor identity to action authorization rather than choosing on the basis of an LLM demo.

### 2.2 CALM-DT and continuous adaptation

CALM-DT is one of the most relevant recent research directions. The authors frame digital twinning as an **in-context learning problem**: state and action variables, available data, and system knowledge may change over time, while conventional approaches often require redesign or retraining. CALM-DT uses fine-tuned encoders to retrieve relevant examples and adapts across diverse state-action spaces without parameter updates.[8]

This is technically important because physical systems evolve. A factory adds a machine, changes a component supplier, modifies a process recipe, or observes a new failure mode. In-context adaptation can reduce the time needed to incorporate new variables into an LLM-based model. It also changes the operational risk: a prompt or retrieved example can alter behavior at inference time, so versioned context, retrieval provenance, test suites, and change approval become as important as model weights.

CALM-DT should not be interpreted as evidence that an LLM can replace a validated physics model. It demonstrates adaptation in benchmarked digital-twin environments. Production systems need out-of-distribution tests, uncertainty calibration, adversarial tests, latency measurements, and comparison against domain baselines before any physical action is permitted.

### 2.3 Principal market gaps

**Standardization is incomplete.** AAS, OpenUSD, OPC UA, FHIR, ontologies, and vendor APIs address different slices of the problem. They do not automatically agree on asset identity, event semantics, time synchronization, quality flags, uncertainty, or action permissions. The LLM may help translate between schemas, but semantic translation is itself a safety-critical process.

**Latency is heterogeneous.** Sensor control may require milliseconds; a maintenance explanation may tolerate seconds; an executive scenario report may tolerate minutes. An LLM call, graph traversal, simulator, and human approval cannot be inserted indiscriminately into a hard real-time loop. A CDT must classify workloads by control criticality and latency budget.

**Hallucination is an operational failure mode.** RAG reduces unsupported generation by supplying evidence, but it cannot repair missing, contradictory, stale, or incorrectly retrieved data. A fluent answer can still be wrong. All high-impact statements should expose source passages, timestamps, confidence, assumptions, and model outputs.

**Evaluation is underdeveloped.** A useful benchmark must assess more than language quality. It should measure state estimation error, forecast error, scenario fidelity, constraint violations, tool-call correctness, time-to-decision, false alarms, unsafe actions, and operator adoption.

## 3. Real-Life Applications and Case Studies

### 3.1 Manufacturing and Industry 5.0

Manufacturing offers the strongest near-term case because assets are instrumented, processes are structured, and many decisions are already documented. A cognitive twin can unify telemetry, maintenance history, engineering drawings, standard operating procedures, quality records, and operator observations.

A maintenance conversation might proceed as follows. The operator asks why vibration increased on a motor. The system resolves the asset identity, retrieves recent vibration trends and comparable failure cases, traverses the equipment graph to inspect connected components, invokes a time-series anomaly model, checks the maintenance manual, and returns a ranked hypothesis list. If the operator asks for a what-if analysis, the twin invokes a degradation or discrete-event model. It can then propose a maintenance window, but the CMMS work order and any machine change remain governed actions.

Siemens describes Industrial Copilots spanning design, planning, operations, and service, including code generation and equipment troubleshooting.[6] This is a credible example of the market moving from generic chat toward domain-specific assistance. The evidence supports decision support and workflow acceleration; it does not establish unrestricted autonomous factory control.

Industry 5.0 adds a human-centric dimension. The best use of an LLM-enabled twin is often to make complex operational knowledge accessible to technicians, preserve expert knowledge, explain robot behavior, and support collaborative decision-making. A system that merely removes the operator may undermine resilience when sensors fail, conditions shift, or the model encounters a novel event.

### 3.2 Healthcare and patient digital twins

Healthcare digital twins are more accurately described as **domain-specific patient or organ models** than as complete computational replicas of a human. Reviews identify data sources including wearables, blood pressure and oxygen measurements, imaging, electrophysiology, written reports, and multi-omics data.[9] They also describe applications in monitoring, diagnosis, treatment planning, drug response, surgical planning, clinical trials, hospital operations, and wellness.[10]

An LLM can add value by structuring longitudinal records, retrieving current guidelines, explaining model outputs, translating a clinician’s question into a simulation request, and identifying missing data. For example, a research twin could ingest a new guideline, identify which patients or model assumptions are affected, and present the changes to a clinical governance team. It should not silently rewrite a validated disease model or make a treatment recommendation without clinical review.

The medical limitations are unusually severe. Patient data is heterogeneous and incomplete; physiological models are uncertain; populations differ; and a seemingly small documentation error can change a clinical conclusion. Privacy, consent, bias, cybersecurity, regulation, and accountability must be designed into the system. A patient-facing conversational interface should be clearly separated from the clinical decision-support and actuation layers.

### 3.3 Supply chains and logistics

A supply-chain twin models suppliers, plants, warehouses, transport lanes, inventory, demand, capacity, costs, lead times, and disruption scenarios. LLMs are useful for extracting signals from contracts, news, supplier communications, and incident reports, then translating natural-language questions into scenario parameters.

BCG reports a Value Chain Digital Twin that combines internal and external data for forecasting, risk detection, scenario planning, procurement, and resource allocation. Its reported client results include 20–30% forecast-accuracy improvement, 50–80% reductions in delays and downtime, and 3–6% procurement cost reductions; these should be treated as vendor-reported case claims rather than independently verified industry benchmarks.[11]

A multi-agent architecture can assign separate roles to sourcing, logistics, production, finance, and sustainability agents. However, agents should debate over a shared state and explicit objective functions, not persuade one another with unconstrained prose. The final plan should be generated by or checked against an optimization solver, inventory constraints, contractual obligations, and human approval thresholds.

### 3.4 Smart cities and crisis management

A city twin may integrate traffic, transit, energy, water, weather, buildings, emergency services, and citizen reports. NLP can classify incident reports and policy documents; vision models can inspect traffic or infrastructure video; the twin can simulate evacuation, road closures, energy demand, or emergency-resource allocation.

The main challenge is governance. A city system affects many people who did not consent to be modeled, and errors can distribute burdens unequally. A useful deployment should begin with planning and situational awareness, disclose data provenance, retain human authority, and conduct equity and resilience testing. Fully autonomous public-safety actuation is not an appropriate first use case.

## 4. Implementation Ideas That Can Be Built Today

### Idea 1: Factory conversational decision-support twin

This system would answer maintenance, quality, and throughput questions over a selected production cell. The MVP would ingest OPC UA or MQTT telemetry, CMMS work orders, manuals, standard operating procedures, and asset metadata. An AAS or equivalent ontology would unify identity; a time-series database would store telemetry; a graph database would store topology; a vector store would index documents; and an LLM would use structured tools to query the twin and call a simulator.

The minimum safe workflow is: retrieve evidence, calculate with a domain model, present a cited answer, and require approval for any work-order or parameter change. Success metrics should include answer grounding, technician time saved, diagnostic precision, false-alarm rate, and unsafe tool-call rate.

### Idea 2: Natural-language scenario planner

A planner would translate questions such as “What if we add a second inspection robot and move the maintenance window to Sunday?” into structured simulation parameters. The LLM performs intent extraction and parameter mapping; a schema validator rejects ambiguous values; a discrete-event, agent-based, or physical simulator evaluates the scenario; and the interface presents trade-offs in throughput, cost, energy, risk, and staffing.

This is one of the safest high-value applications because the LLM does not directly control the plant. The main technical work is maintaining a reliable mapping between natural-language concepts and executable model parameters.

### Idea 3: Multimodal maintenance twin

A vision-language model can inspect video frames for visible defects, while vibration, temperature, current, and acoustic models detect non-visual degradation. A maintenance agent combines the signals with manuals and prior work orders. The system produces an evidence-linked alert such as: “The belt guard appears misaligned in frames 10:22–10:25; vibration at bearing B-17 is 2.1 standard deviations above its 30-day baseline; inspect tension and bearing lubrication.”

The vision model should never be the sole basis for a safety action. Temporal aggregation, calibrated detectors, sensor fusion, and a human verification step are necessary.

### Idea 4: Patient-twin research and care-coordination assistant

A research-grade patient twin could summarize longitudinal records, retrieve new guidelines, compare candidate trajectories, and identify missing measurements. It could support clinical-trial simulation or care coordination without autonomously prescribing. FHIR-compatible records, imaging metadata, wearable data, a privacy-preserving feature store, and a validated disease-specific model would form the foundation. The LLM would be restricted to retrieval, explanation, and workflow support.

### Idea 5: Multi-agent supply-chain control tower

A control tower would maintain a graph of suppliers, assets, routes, inventory, orders, and contracts. Specialized agents would monitor external events, assess sourcing alternatives, model logistics, calculate carbon impact, and prepare negotiation or allocation options. A solver would enforce capacity, lead-time, budget, and service constraints. Human approval would be required for supplier changes, purchase commitments, and customer-affecting decisions.

### Recommended technology stack

| Layer | Practical options | Design requirement |
|---|---|---|
| Connectivity | OPC UA, MQTT, Kafka, REST, FHIR, S3-compatible storage | Explicit asset identity, timestamps, quality flags, and provenance |
| State and time series | PostgreSQL/TimescaleDB, InfluxDB, lakehouse | Versioned state, replay, retention, and late-event handling |
| Semantic model | AAS, RDF/OWL, property graph, domain ontologies | Stable identifiers and relationship semantics |
| Retrieval | PostgreSQL pgvector, Milvus, Weaviate, OpenSearch, GraphRAG | Hybrid vector plus graph retrieval; source citations |
| LLM layer | Enterprise API or open-source model served privately | Structured output, tool calling, prompt/context versioning |
| Multimodal layer | VLM, image/video embeddings, signal models | Evidence synchronization across modalities |
| Simulation | OpenUSD/Omniverse, Modelica, AnyLogic, SimPy, custom physics/ML models | Calibrated models and scenario reproducibility |
| Optimization | OR-Tools, Gurobi, Pyomo, domain solvers | Hard constraints and objective traceability |
| Agent orchestration | Graph workflow or state-machine framework | Deterministic transitions, timeouts, retries, and budgets |
| Governance | IAM, policy engine, audit logs, approval UI, observability | Least privilege, rollback, human override, incident review |

## 5. Novel Techniques and How to Implement Them

### 5.1 In-context learning for continuous adaptation

In-context adaptation should be implemented as a controlled update pipeline, not an informal prompt edit. A new component, guideline, or operating regime should be represented as a versioned object with source, effective date, scope, confidence, and test cases. Retrieval should select relevant examples or documents. The LLM should produce a candidate interpretation or model update in a typed schema. A validator should check schema, units, ranges, dependencies, and policy. The candidate should be evaluated in replay and simulation before promotion.

```text
New fact / variable / document
          |
          v
Normalize + assign identity + provenance
          |
          v
Retrieve affected twin entities and scenarios
          |
          v
LLM proposes structured update
          |
          v
Schema, unit, dependency, and policy validation
          |
          v
Replay + simulation + regression tests
          |
    +-----+------+
    |            |
  reject      approve
                 |
                 v
          Versioned deployment
                 |
                 v
          Monitor and rollback
```

This approach captures CALM-DT’s central insight—adaptation without parameter updates—while adding the engineering controls required in production.[8]

### 5.2 Multimodal agentic architectures

The twin should maintain a synchronized event model across text, images, video, telemetry, and structured records. A practical design uses specialist models for each modality and an LLM as a coordinator. For example, the video model identifies a visual anomaly, the time-series model estimates deviation, the graph retrieves connected assets, and the LLM writes an explanation and selects the next diagnostic tool.

The core technical problem is not merely multimodal input. It is **cross-modal time and identity alignment**. Every observation needs an asset ID, timestamp, spatial reference, sensor quality, and confidence. Without this, the LLM may combine observations that are individually true but refer to different assets or times.

### 5.3 Role-based LLM agents

Specialized agents can make complex tasks easier to decompose. A maintenance agent can inspect equipment health; a sourcing agent can identify alternative parts; a safety agent can check procedures; and a planner can compare options. The agents should not operate as a free-form debate club. They need a shared state model, explicit roles, typed messages, budgets, termination conditions, and a final adjudicator or solver.

```text
Shared twin state and objective
              |
      +-------+--------+
      |       |        |
      v       v        v
 Maintenance Sourcing Safety
   agent      agent    agent
      |       |        |
      +-------+--------+
              v
Evidence and constraint reconciliation
              |
              v
Optimization / simulation adjudicator
              |
              v
Human approval or bounded execution
```

A useful evaluation compares a multi-agent system against a single-agent baseline and a non-agentic solver. Metrics should include solution quality, cost, constraint violations, time, token usage, reproducibility, and failure recovery—not simply conversational preference.

## 6. Physical and Theoretical Limitations

| Limitation | Why it matters | Mitigation |
|---|---|---|
| Hallucinated or unsupported claims | A plausible explanation can cause an incorrect maintenance or clinical decision | RAG with citations, structured queries, abstention, evidence thresholds |
| Stale or incomplete twin state | The model may reason correctly over an incorrect state | Data-quality monitoring, timestamps, freshness policies, sensor validation |
| Distribution shift | New parts, regimes, weather, patients, or failures may invalidate learned behavior | OOD detection, replay, uncertainty, recalibration, human escalation |
| Latency mismatch | LLM response time may be incompatible with control loops | Keep hard real-time control deterministic; use LLMs for supervisory layers |
| Semantic interoperability | Different systems may represent the same asset or event differently | AAS/ontologies, identity resolution, schema contracts, validation |
| Cyber-physical security | Prompt injection or compromised data could influence actions | Isolation, signed data, least privilege, tool allowlists, monitoring |
| Privacy and confidentiality | Health, worker, supplier, and infrastructure data are sensitive | Data minimization, private serving, encryption, access controls, consent |
| Accountability | It may be unclear who approved or caused a decision | Audit logs, model/version provenance, human sign-off, rollback |
| Model and context cost | Frequent retrieval and multimodal inference can be expensive | Caching, model routing, smaller specialist models, event-triggered inference |
| Human factors | Over-trust or alert fatigue can make the system less safe | Calibrated explanations, uncertainty, training, workload-aware UX |

Theoretical potential is high because language models provide a general interface to heterogeneous knowledge and can coordinate tools across domains. Physical potential is bounded by observability, model fidelity, actuation authority, and validation. A twin cannot infer an unobserved state merely because an LLM can describe it fluently. Nor can in-context learning guarantee correct adaptation when the new context is biased, adversarial, or outside the model’s competence.

## 7. Recommended Adoption Roadmap

**Phase 1: Grounded read-only assistant.** Start with document search, asset lookup, telemetry summaries, and cited explanations. Measure grounding and operator value before allowing action.

**Phase 2: Simulation-backed decision support.** Add what-if scenarios, calibrated forecasting, and optimization. Require explicit assumptions and compare against existing expert workflows.

**Phase 3: Workflow execution with approval.** Allow typed actions such as creating work orders, drafting purchase plans, or scheduling inspections. Enforce authorization, validation, audit, and rollback.

**Phase 4: Bounded autonomy.** Permit automatic execution only for low-risk, reversible actions with clear constraints and monitoring. Keep safety-critical control outside the LLM.

**Phase 5: Cross-twin coordination.** Connect plant, supply-chain, workforce, energy, and customer twins only after identity, provenance, policy, and failure-handling standards are mature.

## Conclusion

NLP and LLMs are likely to become a major interface and orchestration technology for digital twins. Their strongest contribution is to make complex models, data, documentation, and workflows accessible through natural language while coordinating retrieval, simulation, and specialized tools. Cognitive digital twins become genuinely useful when language is anchored to live state, structured semantics, executable models, and governance.

The most defensible near-term strategy is therefore **hybrid intelligence**. Use deterministic models and optimization for physical truth and constraints; use graphs and RAG for semantic grounding; use multimodal models for perception; use LLMs for interpretation, planning, explanation, and coordination; and use humans and policy gateways for accountability. This architecture can deliver practical value today without confusing linguistic fluency with physical reliability.

## References

[1]: https://www.nature.com/articles/s41746-024-01073-0 "A scoping review of digital twins for health, npj Digital Medicine"

[2]: https://www.sciencedirect.com/science/article/pii/S2213846325001762 "A survey of cognitive digital twin and the potential use of LLMs"

[3]: https://docs.nvidia.com/omniverse/index.html "NVIDIA Omniverse Documentation"

[4]: https://adk.dev/ "Agent Development Kit Documentation"

[5]: https://eclipse.dev/basyx/ "Eclipse BaSyx: Industry 4.0 Operating System"

[6]: https://www.siemens.com/en-us/company/insights/generative-ai-industrial-copilot/ "Siemens Industrial Copilot"

[7]: https://ieeexplore.ieee.org/abstract/document/10559483/ "Generation of Asset Administration Shell with Large Language Model Agents"

[8]: https://arxiv.org/abs/2506.12091 "Continuously Updating Digital Twins using Large Language Models"

[9]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10608065/ "Digital Twins in Healthcare: Methodological Challenges and Opportunities"

[10]: https://www.nature.com/articles/s41746-024-01073-0 "Digital twins for health: a scoping review"

[11]: https://www.bcg.com/publications/2024/using-digital-twins-to-manage-complex-supply-chains "Using Digital Twins to Manage Complex Supply Chains"

[12]: https://arxiv.org/html/2503.02167v1 "Leveraging Large Language Models for Enhanced Digital Twin Modeling: Trends, Methods, and Challenges"

[13]: https://www.sciencedirect.com/science/article/pii/S0166361525000958 "Enhancing retrieval-augmented generation for interoperable industrial knowledge representation and inference toward cognitive digital twins"
