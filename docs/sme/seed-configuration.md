# MatterFlow Seed Configuration (first deployment)

**Author:** eDiscovery operations SME. **Status:** proposal for admin review. Companion machine-readable file: `docs/sme/seed-configuration.json` (same content, plain field names; a developer adapts it to the form schema).

## 0. How to use this document

- Everything here is **configuration, not code**: priorities, pods, roles, custom fields, Asset Types, Step Definitions, Workflows, Task Types. It must be creatable through the admin console and loadable by an idempotent seeding routine (architecture 4.6) on a first deployment, then edited freely.
- Field types and rule grammar follow architecture section 7 (`TEXT, TEXTAREA, NUMBER, CHECKBOX, SELECT, RADIO, MULTISELECT, DATE, DATETIME, URL, ASSET_REF, USER_REF`; rules `eq/neq/in/contains/isTrue/isNotEmpty` with `and/or`). "Show when" / "Required when" columns are the structured conditional rules. Option keys are the slugged label.
- No file upload fields appear anywhere (no attachments stored). Where a document matters (cover letters, ESI protocols, SOPs) the form asks for a **reference** (URL or location) or a short summary.
- **Never store secrets.** Fields about encryption ask *where the key/password is held*, never the key itself.
- **Do not put privileged content in forms.** Handling flags and notes carry labels and instructions only.
- Documentation URLs on steps are placeholders (`sharepoint.example.firm`) for the admin to replace.
- Naming convention used throughout: the combined reference `#####-#####` (e.g. `00343-00012`) prefixes workspace names, media labels, collection names and production volumes, because the firm already uses it in Relativity workspace names, folders and emails.
- Counts: 15 Task Types, 10 Step Definitions, 8 Workflows, 7 Asset Types, 9 roles plus System Admin.

### Seed workflow map

| Task Type | Default workflow | Also eligible |
|---|---|---|
| Collection Receipt | Media and Data Receipt | - |
| Data Processing | Standard Processing and Load | - |
| Relativity Workspace Setup | Workspace Setup and Access | - |
| Data Load / Overlay | Data Load Only | - |
| Search and Culling | Search, Analytics and Review Prep | - |
| Review Setup and Batching | Search, Analytics and Review Prep | - |
| Analytics / TAR Setup | Search, Analytics and Review Prep | - |
| Production (Outgoing) | Standard Production | - |
| Incoming Production Intake | Data Load Only | Media and Data Receipt |
| Harvey Vault Request | Workspace Setup and Access | - |
| Physical Media Custody Event | Quick Request | Media and Data Receipt |
| Access Request | Quick Request | Workspace Setup and Access |
| Export / Transfer | Delivery, Return and Disposition | - |
| Archive and Disposition | Delivery, Return and Disposition | Quick Request |
| General / Ad Hoc Request | Quick Request | - |

## 1. Reference data

### 1.1 Priorities

| Order | Label | Default | Meaning for operations |
|---|---|---|---|
| 1 | Critical |  | Court-ordered or same-day regulatory deadline, production going out today, or data-loss risk (media at risk, workspace deletion in progress). Work stops other work. |
| 2 | High |  | Hard external deadline within about 3 business days, or a partner/director escalation. |
| 3 | Normal | Y | Standard request. Default. |
| 4 | Low |  | No deadline pressure: housekeeping, archive, training, nice-to-have reports. |

### 1.2 Status display labels

| Code | Label | Convention |
|---|---|---|
| `NEW` | New |  |
| `IN_PROGRESS` | In Progress |  |
| `ON_HOLD` | On Hold | Convention: always add a comment saying what the Task is waiting on and from whom. |
| `COMPLETED` | Completed |  |
| `CANCELLED` | Cancelled |  |

### 1.3 Pods

| Pod | Scope |
|---|---|
| Processing Pod | Ingestion, processing, exception handling, loads into Relativity. |
| Production & Delivery Pod | Outgoing/incoming productions, exports, secure transfers, media shipping. |
| Analytics Pod | Search terms, analytics, TAR/CAL, Harvey vault data prep, reporting. |
| Workspace & Support Pod | Workspace setup, access requests, review setup, archive/disposition, general help desk. |
| Forensics & Collections Liaison | Receipt of collected data and physical media; liaison with forensic vendors. |

### 1.4 Seed Client and Matter

| Client | Matter | Name | Purpose |
|---|---|---|---|
| 00001 | 00001 | eDiscovery Department - General Administration | Home for training, tool issues, vendor evaluations, access reviews that belong to no client matter. Client: Firm Internal (eDiscovery Department). Example only: use the firm's real internal number. |

## 2. Roles and permissions

The first five roles match the architecture starter matrix (section 6.3); the last four are additions. All are editable. Configuration/user management stays System Admin only except where noted.

| Permission group | System Admin | Director | Project Manager | Pod Lead | Data Technician | Data Scientist | Intake Coordinator | Read-Only Observer | Configuration Admin | Compliance Auditor |
|---|---|---|---|---|---|---|---|---|---|---|
| View (Client, Matter, Project, Task, Asset, Pod) | X | X | X | X | X | X | X | X | X | X |
| Client.Create/Edit | X | X | X | X | - | - | - | - | - | - |
| Matter.Create/Edit | X | X | X | X | - | - | - | - | - | - |
| EditNumber (Client, Matter) | X | X | - | - | - | - | - | - | - | - |
| Matter.SetActive | X | X | X | - | - | - | - | - | - | - |
| Project Create/Edit/Archive | X | X | X | X | X | - | - | - | - | - |
| Task.Create/Edit/Assign/SetPriority | X | X | X | X | X | X | X | - | - | - |
| Task.ChangeStatus/Complete/Reopen | X | X | X | X | X | X | - | - | - | - |
| Task.Cancel | X | X | X | X | X | X | X | - | - | - |
| Task.Comment | X | X | X | X | X | X | X | X | - | - |
| Workflow.Execute/StepReopen | X | X | X | X | X | X | - | - | - | - |
| Asset Create/Edit/Link | X | X | X | X | X | X | X | - | - | - |
| Pod.Manage/ManageMembers | X | X | - | X | - | - | - | - | X | - |
| User.View | X | X | - | - | - | - | - | - | - | X |
| Dashboard.ViewDepartment | X | X | X | X | - | - | - | X | - | X |
| Audit.View | X | X | - | - | - | - | - | - | - | X |
| TaskType/Workflow/AssetType/CustomField/Priority/StatusLabel.Manage | X | - | - | - | - | - | - | - | X | - |
| Role.Manage, User.Manage | X | - | - | - | - | - | - | - | - | - |

| Role | Intent |
|---|---|
| System Admin | Built-in. All permissions. |
| Director | eDiscovery Director: oversight of all work, matter administration, audit visibility. |
| Project Manager | Runs intake with attorneys, creates Clients/Matters/Projects, assigns and monitors work. |
| Pod Lead | Leads a Pod: balances workload, manages Pod membership, executes work. |
| Data Technician | Executes workflows; creates Projects, Tasks and Assets; assigns and reprioritizes work. |
| Data Scientist | Analytics and TAR specialist. Executes workflows; no Project management. |
| Intake Coordinator | Receives and logs requests, assigns to Pods. Does not execute workflow steps. |
| Read-Only Observer | Firm leadership, knowledge management or attorney liaison who needs to see status. Comments only. |
| Configuration Admin | Delegated configuration owner (usually Director's delegate). Cannot manage roles or users. |
| Compliance Auditor | Risk / compliance review of activity and access. No operational edits. |

## 3. Custom fields on core objects

### 3.1 Client

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `billing_matter_contact` | Client eDiscovery contact (name / email) | TEXT |  |  |  |  |
| `outside_counsel_guidelines` | Outside counsel guidelines / data handling restrictions | SELECT |  | None known; Restrictions on AI / third-party tools; Data must be returned or destroyed at matter close; Both of the above; Other (see notes) . Drives Harvey and vendor-transfer decisions. Detail lives in the firm's records, not here. |  |  |
| `client_notes` | Handling notes | TEXTAREA |  | Short operational note only. |  |  |

### 3.2 Matter

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `case_caption` | Case caption / short name | TEXT |  |  |  |  |
| `court_forum` | Court / forum | TEXT |  |  |  |  |
| `court_case_number` | Court case number | TEXT |  |  |  |  |
| `responsible_attorney` | Responsible attorney | TEXT |  | Free text (attorneys are not application users in Phase 1). |  |  |
| `paralegal_contact` | Primary paralegal / contact | TEXT |  |  |  |  |
| `matter_type` | Matter type | SELECT |  | Litigation; Government investigation / regulatory; Internal investigation; Arbitration; Transactional / second request; Other |  |  |
| `esi_protocol_status` | ESI protocol / order status | SELECT |  | None; Negotiating; Agreed / entered; Not applicable |  |  |
| `esi_protocol_ref` | ESI protocol reference (URL or document location) | URL |  |  | esi_protocol_status in negotiating, agreed_entered |  |
| `clawback_order` | Clawback / FRE 502(d) order | SELECT |  | Entered; Stipulated, not yet entered; None; Unknown |  |  |
| `legal_hold_status` | Legal hold status (informational) | SELECT |  | Hold in place; No hold; Released; Unknown . Informational only. The hold itself is managed outside MatterFlow. |  |  |
| `sensitivity_flag` | Sensitivity | SELECT |  | Standard; Highly sensitive (use code name in titles) . Phase 1 has no ethical walls. If Highly sensitive, use the code name in Task titles and keep detail out of descriptions. |  |  |
| `code_name` | Matter code name | TEXT |  |  | sensitivity_flag = highly_sensitive_use_code_name_in_titles | sensitivity_flag = highly_sensitive_use_code_name_in_titles |
| `trial_date` | Trial / key hearing date | DATE |  |  |  |  |
| `discovery_cutoff` | Discovery cutoff | DATE |  |  |  |  |

### 3.3 Project

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `workstream` | Workstream | SELECT |  | Collection and processing; Review support; Productions; Incoming productions; Data management / disposition; Other |  |  |
| `project_deadline` | Project target date | DATE |  |  |  |  |

## 4. Asset Types

### 4.1 Relativity Workspace

Status values: Planned, Active, Archived, Deleted. Display Name follows the firm convention: `#####-##### - Short matter name` (e.g. `00343-00012 - Smith v Acme`).

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `workspace_artifact_id` | Workspace Artifact ID | NUMBER | Y | From the Relativity workspace URL / admin page. |  |  |
| `environment` | Relativity instance / environment | SELECT | Y | Production instance; Secondary / regional instance; Sandbox / test; RelativityOne tenant (other) |  |  |
| `instance_url` | Workspace URL | URL |  |  |  |  |
| `template_used` | Template | SELECT |  | Standard Review; Early Case Assessment; Production only; Custom |  |  |
| `size_gb` | Approximate size (GB) | NUMBER |  |  |  |  |
| `naming_verified` | Name follows #####-##### convention | CHECKBOX |  |  |  |  |
| `planned_archive_date` | Planned review / archive date | DATE |  |  |  |  |

### 4.2 Harvey Vault

Status values: Planned, Active, Retired, Deleted.

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `vault_name` | Vault name in Harvey | TEXT | Y |  |  |  |
| `vault_url` | Vault link | URL |  |  |  |  |
| `vault_purpose` | Purpose | SELECT | Y | Document analysis; Contract / diligence review; Deposition / testimony prep; Research workspace; Other |  |  |
| `client_ai_use_confirmed` | Client permission for AI tool use confirmed | SELECT | Y | Confirmed permitted; Not yet confirmed; Client prohibits . Check the client's outside counsel guidelines before loading client data. |  |  |
| `file_count` | Approx. number of files | NUMBER |  |  |  |  |
| `source_asset` | Source data (workspace or data set) | ASSET_REF |  |  |  |  |
| `shared_externally` | Shared outside the firm | CHECKBOX |  |  |  |  |
| `sharing_notes` | Who and under what agreement | TEXT |  |  | shared_externally isTrue | shared_externally isTrue |
| `retention_review_date` | Delete / retire by | DATE |  |  |  |  |

### 4.3 Physical Media

Status values: In custody, Checked out, At vendor, Returned, Destroyed. Display Name = firm media label, e.g. `00343-00012-M003` (matter ref + sequence). Label the physical item the same way.

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `media_label` | Media label / barcode | TEXT | Y | The label physically affixed to the item. |  |  |
| `media_type` | Media type | SELECT | Y | External hard drive; SSD; USB flash drive; CD / DVD; Backup tape; Laptop / desktop; Mobile phone / tablet; Other |  |  |
| `make_model` | Make / model | TEXT |  |  |  |  |
| `serial_number` | Serial number | TEXT | Y |  |  |  |
| `capacity_gb` | Capacity (GB) | NUMBER |  |  |  |  |
| `received_date` | Date received | DATE | Y |  |  |  |
| `received_from` | Received from (person / organization) | TEXT | Y |  |  |  |
| `evidence_seal_no` | Tamper-evident seal / bag number | TEXT |  |  |  |  |
| `condition_on_receipt` | Condition on receipt | SELECT | Y | Sealed and intact; Unsealed; Visibly damaged; Not inspected |  |  |
| `hash_algorithm` | Hash algorithm (if hash of the image/contents recorded) | SELECT |  | MD5; SHA-1; SHA-256 |  |  |
| `hash_value` | Hash value | TEXT |  |  | hash_algorithm isNotEmpty | hash_algorithm isNotEmpty |
| `is_encrypted` | Encrypted | CHECKBOX |  |  |  |  |
| `key_location` | Where the key / password is held (reference only) | TEXT |  | NEVER type the password or key here. Record where it is held, e.g. 'firm password vault, entry X'. | is_encrypted isTrue | is_encrypted isTrue |
| `storage_location` | Current storage location | TEXT | Y | e.g. 'Evidence cage B, shelf 3' or the vendor name if offsite. |  |  |
| `custody_holder` | Current custodian of the item | TEXT | Y | Person or organization who physically holds it now. Update on every transfer (also log a Media Custody Event Task). |  |  |
| `disposition_date` | Return / destruction date | DATE |  |  | custody_status_note in returned, destroyed |  |
| `disposition_reference` | Return receipt / destruction certificate reference | TEXT |  |  | custody_status_note in returned, destroyed | custody_status_note in returned, destroyed |
| `custody_status_note` | Disposition | SELECT |  | Retained; Returned; Destroyed . Mirror of the Asset status for the conditional fields below it. |  |  |

### 4.4 Collection / Data Set

Status values: Received, Verified, Processed, Superseded, Disposed. Display Name = `#####-##### - Custodian or source - collection date` (e.g. `00343-00012 - Jones mailbox - 2026-09-14`).

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `custodians` | Custodian(s) / data owner(s) | TEXTAREA | Y | One per line: Last, First (title / department). Non-custodial sources: name of system or share. |  |  |
| `data_sources` | Data sources | MULTISELECT | Y | Email (Exchange / M365); Network share / file server; Laptop / desktop image; Mobile device; Cloud storage; Chat (Teams, Slack); Database / structured data; Social media / web; Other |  |  |
| `date_range_start` | Collection date range start | DATE |  |  |  |  |
| `date_range_end` | Collection date range end | DATE |  |  |  |  |
| `collection_date` | Collection date | DATE | Y |  |  |  |
| `collection_method` | Collection method | SELECT | Y | Forensic image; Targeted forensic collection; Remote / API collection; Custodian self-collection; Client IT export; Third-party export; Other |  |  |
| `collected_by` | Collected by (person / vendor) | TEXT | Y |  |  |  |
| `collection_tool` | Tool / software | TEXT |  |  | collection_method in forensic_image, targeted_forensic_collection, remote_api_collection |  |
| `self_collection_notes` | Self-collection oversight notes | TEXTAREA |  | Who supervised, what instructions were given. | collection_method = custodian_self_collection | collection_method = custodian_self_collection |
| `source_media` | Source physical media | ASSET_REF |  | Link the Physical Media asset it arrived on, if any. |  |  |
| `volume_gb` | Volume (GB) | NUMBER |  |  |  |  |
| `file_count` | Approx. file / item count | NUMBER |  |  |  |  |
| `hash_verified` | Hash verified on receipt | CHECKBOX |  |  |  |  |
| `storage_path` | Storage location on firm systems | TEXT |  |  |  |  |

### 4.5 Production

Status values: Planned, In preparation, Produced, Superseded / re-produced, Clawed back. Display Name = `#####-##### - PROD###` (e.g. `00343-00012 - PROD004`). Volume names match the cover letter.

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `production_volume` | Production volume name | TEXT | Y |  |  |  |
| `produced_to` | Produced to (party / recipient) | TEXT | Y |  |  |  |
| `production_date` | Production (send) date | DATE |  |  |  |  |
| `source_workspace` | Source workspace | ASSET_REF | Y |  |  |  |
| `bates_prefix` | Bates prefix | TEXT | Y |  |  |  |
| `bates_begin` | Bates begin | TEXT | Y |  |  |  |
| `bates_end` | Bates end | TEXT | Y |  |  |  |
| `doc_count` | Document count | NUMBER |  |  |  |  |
| `page_count` | Page count | NUMBER |  |  |  |  |
| `production_format` | Format | SELECT | Y | TIFF + load file; Native + load file; Searchable PDF; Mixed (natives for spreadsheets / media) |  |  |
| `load_file_spec` | Load file specification | TEXT |  |  | production_format in tiff_load_file, native_load_file, mixed_natives_for_spreadsheets_media |  |
| `delivery_method` | Delivery method | SELECT |  | Secure file transfer link; Encrypted media shipped; Client portal; Court e-filing; Other |  |  |
| `shipping_media` | Production media shipped | ASSET_REF |  |  | delivery_method = encrypted_media_shipped | delivery_method = encrypted_media_shipped |
| `privilege_log` | Privilege log accompanying this volume | CHECKBOX |  |  |  |  |
| `clawback_protection` | Clawback protection | SELECT |  | FRE 502(d) order; Stipulated agreement; None; Unknown |  |  |
| `confidentiality_designations` | Confidentiality designations applied | CHECKBOX |  |  |  |  |
| `designation_scheme` | Designation scheme | TEXT |  | e.g. CONFIDENTIAL / AEO as per protective order | confidentiality_designations isTrue | confidentiality_designations isTrue |

### 4.6 Third-Party Dataset

Status values: Requested, Received, Processed, Returned / disposed.

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `provider` | Provider (company / person) | TEXT | Y |  |  |  |
| `platform` | Source platform | SELECT | Y | Slack; Microsoft Teams; Salesforce / CRM; Google Workspace; Messaging / mobile export; Financial / ERP system; Opposing-party production; Other |  |  |
| `dataset_description` | What the data set is | TEXT | Y |  |  |  |
| `export_format` | Export format | TEXT |  |  |  |  |
| `received_date` | Date received | DATE |  |  |  |  |
| `data_owner_contact` | Data owner contact | TEXT |  |  |  |  |
| `contains_pii` | Contains PII / PHI | CHECKBOX |  |  |  |  |
| `pii_handling` | PII / PHI handling requirements | TEXTAREA |  |  | contains_pii isTrue | contains_pii isTrue |
| `cross_border` | Data originates outside the US | CHECKBOX |  |  |  |  |
| `origin_country` | Country / regime | TEXT |  |  | cross_border isTrue | cross_border isTrue |
| `source_media` | Delivered on media | ASSET_REF |  |  |  |  |

### 4.7 Other

Status values: Active, Inactive.

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `description_detail` | What this is | TEXT | Y |  |  |  |
| `reference` | Reference (URL or ID) | TEXT |  |  |  |  |

## 5. Step Definitions (library)

Each step also carries free-form **tags** (the `tags` list of the step in `seed-configuration.json`), applied when the step is first created: S01 Intake; S02 Intake, Collection; S03 Processing, Relativity; S04 Processing; S05 Relativity, Processing, QC; S06 QC, Review; S07 Production, Relativity, QC; S08 Production; S09 Relativity, Review; S10 Close-out. Admins can change them at any time; the seed never overwrites the tags of a step that already exists.

| Code | Title | Used in workflows |
|---|---|---|
| S01 | Intake Review and Scope Confirmation | Standard Processing and Load, Data Load Only, Standard Production, Workspace Setup and Access, Media and Data Receipt, Quick Request, Search, Analytics and Review Prep, Delivery, Return and Disposition |
| S02 | Data Receipt and Integrity Verification | Standard Processing and Load, Data Load Only, Media and Data Receipt |
| S03 | Processing Execution | Standard Processing and Load |
| S04 | Exception Handling | Standard Processing and Load |
| S05 | Data Load and Count Reconciliation | Standard Processing and Load, Data Load Only |
| S06 | Quality Control Check | Standard Processing and Load, Data Load Only, Standard Production, Search, Analytics and Review Prep, Delivery, Return and Disposition |
| S07 | Production Generation and Validation | Standard Production |
| S08 | Delivery, Transfer and Confirmation | Standard Production, Delivery, Return and Disposition |
| S09 | Workspace Configuration and Permissions | Workspace Setup and Access |
| S10 | Close-out and Documentation | Standard Processing and Load, Data Load Only, Standard Production, Workspace Setup and Access, Media and Data Receipt, Quick Request, Search, Analytics and Review Prep, Delivery, Return and Disposition |

### S01 Intake Review and Scope Confirmation

Confirm the request is understood, complete and correctly categorized before work starts.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/intake-review

Instructions:

> 1. Read the request, Task form and any linked assets.  
> 2. Confirm Matter, deadline driver and handling flags. If privileged or AEO flags are set, confirm segregation instructions.  
> 3. Check that source and target assets exist in this Matter's Asset registry; create missing ones.  
> 4. If anything is unclear, ask the requestor (email/phone) and record the answer in a Task comment.  
> 5. Estimate volume so the Pod can plan.  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `scope_confirmed` | Scope understood and confirmed | CHECKBOX | Y |  |  |  |
| `confirmation_method` | How confirmed | SELECT | Y | Email reply; Phone / meeting; Request was unambiguous |  |  |
| `clarification_needed` | Clarification was needed | CHECKBOX |  |  |  |  |
| `clarification_notes` | What was clarified | TEXTAREA |  |  | clarification_needed isTrue | clarification_needed isTrue |
| `estimated_volume_gb` | Estimated volume (GB) | NUMBER |  |  |  |  |
| `assets_registered` | Needed assets exist in Asset registry | CHECKBOX | Y |  |  |  |

### S02 Data Receipt and Integrity Verification

Receive the data, verify it is complete and uncorrupted, and record where it lives.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/data-receipt

Instructions:

> 1. Log the receipt time and who delivered it.  
> 2. Copy to the designated staging path; never work from the original media.  
> 3. Compute hashes and compare to the sender's values (SHA-256 preferred). A mismatch stops work: escalate to the requestor.  
> 4. Run malware scan.  
> 5. If content is encrypted, record WHERE the key is held (never the key).  
> 6. Update the Physical Media / Collection asset (location, custody holder, status).  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `received_datetime` | Received (date and time) | DATETIME | Y |  |  |  |
| `delivered_by` | Delivered by | TEXT | Y |  |  |  |
| `staging_path` | Staging path | TEXT | Y |  |  |  |
| `hash_algorithm` | Hash algorithm | SELECT | Y | MD5; SHA-1; SHA-256 |  |  |
| `hash_result` | Hash comparison | SELECT | Y | Match; Mismatch; Sender provided no hash |  |  |
| `hash_mismatch_notes` | Mismatch action taken | TEXTAREA |  |  | hash_result = mismatch | hash_result = mismatch |
| `file_count_received` | File count received | NUMBER |  |  |  |  |
| `malware_scan` | Malware scan | SELECT | Y | Clean; Threat found - quarantined; Not run (explain in comment) |  |  |
| `encrypted_content` | Content encrypted | CHECKBOX |  |  |  |  |
| `key_location` | Where key is held (reference only) | TEXT |  |  | encrypted_content isTrue | encrypted_content isTrue |

### S03 Processing Execution

Run the processing job with the agreed settings and record results.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/processing

Instructions:

> 1. Create the processing set using the Task form settings (profile, dedupe, time zone, OCR).  
> 2. Inventory, then discover, then publish. Do not publish before reviewing discovery counts.  
> 3. Record job names and counts below.  
> 4. If you deviate from the requested settings, say why.  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `processing_tool` | Tool | SELECT | Y | Relativity Processing; Nuix; Other |  |  |
| `job_name` | Job / processing set name | TEXT | Y |  |  |  |
| `docs_discovered` | Documents discovered | NUMBER | Y |  |  |  |
| `docs_published` | Documents published | NUMBER | Y |  |  |  |
| `docs_errored` | Documents in error | NUMBER | Y |  |  |  |
| `settings_deviation` | Settings differ from request | CHECKBOX |  |  |  |  |
| `deviation_notes` | Deviation and reason | TEXTAREA |  |  | settings_deviation isTrue | settings_deviation isTrue |

### S04 Exception Handling

Resolve or escalate files that failed processing (password-protected, corrupt, unsupported).

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/exceptions

Instructions:

> 1. Export the error report.  
> 2. Request passwords through the requestor; do not guess or crack without attorney instruction.  
> 3. Re-process what can be fixed.  
> 4. Anything excluded must be excluded with requestor/attorney instruction; record who instructed you (the approval itself happens outside MatterFlow).  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `exceptions_total` | Exceptions at start | NUMBER | Y |  |  |  |
| `exceptions_remaining` | Exceptions remaining | NUMBER | Y |  |  |  |
| `resolution_actions` | Actions taken | MULTISELECT | Y | Passwords obtained; Re-processed with other tool; Re-collected; Escalated to requestor; Excluded on instruction |  |  |
| `excluded_instructed_by` | Exclusion instructed by | TEXT |  |  | resolution_actions includes excluded_on_instruction | resolution_actions includes excluded_on_instruction |
| `exclusion_date` | Date instructed | DATE |  |  | resolution_actions includes excluded_on_instruction | resolution_actions includes excluded_on_instruction |

### S05 Data Load and Count Reconciliation

Load data into the target workspace and reconcile counts to the source.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/load-reconcile

Instructions:

> 1. Load with the agreed field map and identifier.  
> 2. Reconcile document counts source vs workspace. Variances must be explained.  
> 3. Spot check metadata and text for 10 documents.  
> 4. Record the workspace asset.  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `workspace_asset` | Target workspace | ASSET_REF | Y |  |  |  |
| `docs_expected` | Documents expected | NUMBER | Y |  |  |  |
| `docs_loaded` | Documents loaded | NUMBER | Y |  |  |  |
| `counts_reconcile` | Counts reconcile | SELECT | Y | Yes; No - variance explained; No - escalated |  |  |
| `variance_explanation` | Variance explanation | TEXTAREA |  |  | counts_reconcile != yes | counts_reconcile != yes |
| `fields_text_ok` | Metadata and extracted text spot checked | CHECKBOX | Y |  |  |  |

### S06 Quality Control Check

Independent check of the work product before it moves on.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/qc

Instructions:

> 1. Use a different person from the one who did the work wherever staffing allows.  
> 2. Choose a method proportionate to risk (productions: full check of counts, Bates, slip sheets, redactions).  
> 3. A Fail result sends the work back; record what must be redone.  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `qc_method` | Method | SELECT | Y | Random sample; Targeted check; Full check; Automated validation |  |  |
| `sample_size` | Sample size | NUMBER |  |  | qc_method = random_sample | qc_method = random_sample |
| `defects_found` | Defects found | NUMBER | Y |  |  |  |
| `qc_by_other_person` | QC performed by someone other than the preparer | CHECKBOX |  |  |  |  |
| `qc_result` | Result | SELECT | Y | Pass; Pass with notes; Fail - rework needed |  |  |
| `rework_notes` | Rework required | TEXTAREA |  |  | qc_result = fail_rework_needed | qc_result = fail_rework_needed |

### S07 Production Generation and Validation

Build the production set and verify Bates, load files, redactions and privilege exclusions.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/production

Instructions:

> 1. Confirm in the Task or a comment that the production set was cleared (attorney sign-off happens outside MatterFlow).  
> 2. Verify NO document tagged privileged / withhold is in the set (run the saved search).  
> 3. Generate with the agreed prefix and numbering; check for Bates gaps and duplicates against previous volumes.  
> 4. Verify redactions are burned in and natives have slip sheets where specified.  
> 5. Validate the load file opens and counts match.  
> 6. Register or update the Production asset.  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `production_asset` | Production asset | ASSET_REF | Y |  |  |  |
| `bates_begin` | Bates begin | TEXT | Y |  |  |  |
| `bates_end` | Bates end | TEXT | Y |  |  |  |
| `doc_count` | Documents | NUMBER | Y |  |  |  |
| `page_count` | Pages | NUMBER |  |  |  |  |
| `bates_gap_check` | Bates continuity vs prior volumes | SELECT | Y | No gaps or overlaps; Gaps explained in notes |  |  |
| `privilege_exclusion_verified` | Verified no privileged / withheld documents in set | CHECKBOX | Y |  |  |  |
| `redactions_verified` | Redactions burned in and verified | CHECKBOX |  |  |  |  |
| `load_file_validated` | Load file validated | CHECKBOX | Y |  |  |  |
| `attorney_cleared` | Attorney cleared set for production (recorded as fact) | CHECKBOX | Y |  |  |  |
| `cleared_by` | Cleared by (name) | TEXT |  |  | attorney_cleared isTrue | attorney_cleared isTrue |

### S08 Delivery, Transfer and Confirmation

Send the deliverable to the recipient securely and capture confirmation.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/delivery

Instructions:

> 1. Encrypt every external delivery. Send passwords by a separate channel.  
> 2. For physical media, label it, log a Media Custody Event Task, and record the carrier tracking number.  
> 3. Capture proof of delivery.  
> 4. Set link expiry no longer than the agreement allows.  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `delivery_datetime` | Sent (date and time) | DATETIME | Y |  |  |  |
| `delivery_method` | Method | SELECT | Y | Secure file transfer link; Encrypted media shipped; Client portal; Court e-filing; Other |  |  |
| `sent_to` | Sent to (name / organization) | TEXT | Y |  |  |  |
| `encryption_applied` | Encryption applied | CHECKBOX | Y |  |  |  |
| `password_sent_separately` | Password sent by separate channel | CHECKBOX |  |  |  |  |
| `tracking_ref` | Tracking number or link ID | TEXT |  |  |  |  |
| `media_asset` | Media shipped | ASSET_REF |  |  | delivery_method = encrypted_media_shipped | delivery_method = encrypted_media_shipped |
| `link_expiry` | Link expiry date | DATE |  |  | delivery_method = secure_file_transfer_link |  |
| `receipt_confirmed` | Receipt confirmed | SELECT | Y | Confirmed by recipient; Awaiting confirmation; Not applicable |  |  |

### S09 Workspace Configuration and Permissions

Create or change a workspace or vault and set access according to the request.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/workspace-setup

Instructions:

> 1. Create from the requested template. Name per convention: #####-##### - short name.  
> 2. Add users per request. External users (vendors, contract reviewers, client personnel) require a confidentiality agreement on file and an end date.  
> 3. Register the workspace/vault as an Asset in this Matter.  
> 4. Re-check the access list against the request before closing.  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `workspace_asset` | Workspace or vault asset | ASSET_REF | Y |  |  |  |
| `naming_convention_ok` | Name follows #####-##### convention | CHECKBOX | Y |  |  |  |
| `template_applied` | Template applied | TEXT |  |  |  |  |
| `users_added` | Users added / changed (count) | NUMBER |  |  |  |  |
| `external_users` | External users included | CHECKBOX |  |  |  |  |
| `nda_on_file` | Confidentiality agreement on file | CHECKBOX |  |  | external_users isTrue | external_users isTrue |
| `access_end_date` | Access end date | DATE |  |  | external_users isTrue | external_users isTrue |
| `layouts_configured` | Layouts / fields configured as requested | CHECKBOX |  |  |  |  |

### S10 Close-out and Documentation

Hand off results, update the Asset registry and leave a clear record.

Documentation URL (placeholder): https://sharepoint.example.firm/ediscovery/sop/closeout

Instructions:

> 1. Update every Asset touched (status, location, counts).  
> 2. Notify the requestor with a short summary: what was done, counts, where it is.  
> 3. Note any follow-up work as a NEW Task (MatterFlow does not clone or chain Tasks).  
> 4. Keep notes factual and free of privileged analysis.  

Inputs:

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `summary_notes` | Summary of work done | TEXTAREA | Y |  |  |  |
| `final_counts` | Final counts / volume | TEXT |  |  |  |  |
| `assets_updated` | Asset registry updated | CHECKBOX | Y |  |  |  |
| `requestor_notified` | Requestor notified | SELECT | Y | Email sent; Verbal; Not needed |  |  |
| `follow_up_needed` | Follow-up work needed | CHECKBOX |  |  |  |  |
| `follow_up_notes` | Follow-up needed | TEXTAREA |  |  | follow_up_needed isTrue | follow_up_needed isTrue |

## 6. Workflows

Skip column: `-` not skippable; `skip` skippable without comment; `skip+comment` skippable and requires a comment.

### Standard Processing and Load (ordered)

Full path from receipt through processing, exceptions, QC and load.

| Seq | Step | Skip |
|---|---|---|
| 1 | S01 Intake Review and Scope Confirmation | - |
| 2 | S02 Data Receipt and Integrity Verification | - |
| 3 | S03 Processing Execution | - |
| 4 | S04 Exception Handling | skip+comment |
| 5 | S06 Quality Control Check | - |
| 6 | S05 Data Load and Count Reconciliation | - |
| 7 | S10 Close-out and Documentation | - |

### Data Load Only (ordered)

Data already processed or supplied as load file; load and reconcile.

| Seq | Step | Skip |
|---|---|---|
| 1 | S01 Intake Review and Scope Confirmation | - |
| 2 | S02 Data Receipt and Integrity Verification | - |
| 3 | S05 Data Load and Count Reconciliation | - |
| 4 | S06 Quality Control Check | skip+comment |
| 5 | S10 Close-out and Documentation | - |

### Standard Production (ordered)

Outgoing production with mandatory QC and delivery confirmation.

| Seq | Step | Skip |
|---|---|---|
| 1 | S01 Intake Review and Scope Confirmation | - |
| 2 | S07 Production Generation and Validation | - |
| 3 | S06 Quality Control Check | - |
| 4 | S08 Delivery, Transfer and Confirmation | - |
| 5 | S10 Close-out and Documentation | - |

### Workspace Setup and Access (unordered)

Workspace, vault and permission changes; steps in any order.

| Seq | Step | Skip |
|---|---|---|
| 1 | S01 Intake Review and Scope Confirmation | - |
| 2 | S09 Workspace Configuration and Permissions | - |
| 3 | S10 Close-out and Documentation | - |

### Media and Data Receipt (ordered)

Receive collected data or physical media and verify integrity.

| Seq | Step | Skip |
|---|---|---|
| 1 | S01 Intake Review and Scope Confirmation | - |
| 2 | S02 Data Receipt and Integrity Verification | - |
| 3 | S10 Close-out and Documentation | - |

### Quick Request (unordered)

Lightweight workflow for simple or ad hoc requests.

| Seq | Step | Skip |
|---|---|---|
| 1 | S01 Intake Review and Scope Confirmation | - |
| 2 | S10 Close-out and Documentation | - |

### Search, Analytics and Review Prep (unordered)

Search terms, analytics, batching and review setup.

| Seq | Step | Skip |
|---|---|---|
| 1 | S01 Intake Review and Scope Confirmation | - |
| 2 | S06 Quality Control Check | skip+comment |
| 3 | S10 Close-out and Documentation | - |

### Delivery, Return and Disposition (ordered)

Exports, returns to client and certified destruction.

| Seq | Step | Skip |
|---|---|---|
| 1 | S01 Intake Review and Scope Confirmation | - |
| 2 | S06 Quality Control Check | - |
| 3 | S08 Delivery, Transfer and Confirmation | - |
| 4 | S10 Close-out and Documentation | - |

## 7. Task Types

Every Task Type's form also carries the standard blocks where relevant: **Deadline** (`deadline_driver`, `deadline_note`) and **Handling flags** (`handling_flags`, `handling_notes`). Requestor, Title, Description, Priority, Due Date, Pod and assignee are core Task fields, not form fields.

| # | Task Type | Eligible workflows (default first) |
|---|---|---|
| 1 | Collection Receipt | Media and Data Receipt |
| 2 | Data Processing | Standard Processing and Load |
| 3 | Relativity Workspace Setup | Workspace Setup and Access |
| 4 | Data Load / Overlay | Data Load Only |
| 5 | Search and Culling | Search, Analytics and Review Prep |
| 6 | Review Setup and Batching | Search, Analytics and Review Prep |
| 7 | Analytics / TAR Setup | Search, Analytics and Review Prep |
| 8 | Production (Outgoing) | Standard Production |
| 9 | Incoming Production Intake | Data Load Only; Media and Data Receipt |
| 10 | Harvey Vault Request | Workspace Setup and Access |
| 11 | Physical Media Custody Event | Quick Request; Media and Data Receipt |
| 12 | Access Request | Quick Request; Workspace Setup and Access |
| 13 | Export / Transfer | Delivery, Return and Disposition |
| 14 | Archive and Disposition | Delivery, Return and Disposition; Quick Request |
| 15 | General / Ad Hoc Request | Quick Request |

### 7.1 Collection Receipt

Collected data (forensic image, export, self-collection) has arrived or will arrive and must be received and verified.

Example title: *Receive Jones laptop image*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `custodians` | Custodian(s) / sources | TEXTAREA | Y | One per line: Last, First (title). For non-custodial sources, name the system or share. |  |  |
| `custodian_count` | Number of custodians | NUMBER |  |  |  |  |
| `data_sources` | Data sources | MULTISELECT | Y | Email (Exchange / M365); Network share / file server; Laptop / desktop image; Mobile device; Cloud storage; Chat (Teams, Slack); Database / structured data; Other |  |  |
| `date_range_start` | Date range start | DATE |  | Leave blank if no start limit. Dates are inclusive. |  |  |
| `date_range_end` | Date range end | DATE |  | Leave blank if no end limit. |  |  |
| `date_basis` | Date field filtered on | SELECT |  | Sent / received; Last modified; Created; Date sent or last modified (either); Not applicable | (date_range_start isNotEmpty OR date_range_end isNotEmpty) | (date_range_start isNotEmpty OR date_range_end isNotEmpty) |
| `collected_by` | Collected by | SELECT | Y | Forensic vendor; Client IT; Firm eDiscovery team; Custodian self-collection; Other |  |  |
| `vendor_name` | Vendor name | TEXT |  |  | collected_by = forensic_vendor | collected_by = forensic_vendor |
| `self_collection_notes` | Self-collection oversight | TEXTAREA |  | Who supervised and what instructions were given. | collected_by = custodian_self_collection | collected_by = custodian_self_collection |
| `delivery_media` | How data is arriving | SELECT | Y | Physical media; Secure file transfer; Cloud share link; Already on firm network |  |  |
| `media_asset` | Physical media asset | ASSET_REF |  | Create the Physical Media asset first so custody starts at receipt. | delivery_media = physical_media | delivery_media = physical_media |
| `expected_volume_gb` | Expected volume (GB) | NUMBER |  |  |  |  |
| `time_zone` | Time zone for dates / processing | SELECT |  | UTC; US Eastern; US Central; US Mountain; US Pacific; Source local time; Other (explain in notes) . Time zone drives date filters, dedupe and email threading results. Confirm with the requestor. |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.2 Data Processing

Process collected data into Relativity (ingestion, extraction, dedupe, OCR).

Example title: *Process Jones mailbox into 00343-00012 workspace*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `source_asset` | Source collection / data set | ASSET_REF | Y |  |  |  |
| `target_workspace` | Target Relativity workspace | ASSET_REF | Y | Asset of type Relativity Workspace in this Matter |  |  |
| `custodians_in_scope` | Custodians in scope | TEXTAREA |  | Leave blank for all custodians in the data set. |  |  |
| `date_range_start` | Date range start | DATE |  | Leave blank if no start limit. Dates are inclusive. |  |  |
| `date_range_end` | Date range end | DATE |  | Leave blank if no end limit. |  |  |
| `date_basis` | Date field filtered on | SELECT |  | Sent / received; Last modified; Created; Date sent or last modified (either); Not applicable | (date_range_start isNotEmpty OR date_range_end isNotEmpty) | (date_range_start isNotEmpty OR date_range_end isNotEmpty) |
| `time_zone` | Time zone for dates / processing | SELECT |  | UTC; US Eastern; US Central; US Mountain; US Pacific; Source local time; Other (explain in notes) . Time zone drives date filters, dedupe and email threading results. Confirm with the requestor. |  |  |
| `processing_profile` | Processing profile | SELECT | Y | Standard; Email only; Native-heavy (spreadsheets, CAD); Custom (describe) |  |  |
| `custom_profile_notes` | Custom profile description | TEXTAREA |  |  | processing_profile = custom_describe | processing_profile = custom_describe |
| `dedupe_scope` | Deduplication | RADIO | Y | Global (across custodians); Per custodian; None |  |  |
| `nist_filter` | Apply NIST / system-file filter | CHECKBOX |  |  |  |  |
| `ocr_required` | OCR required | CHECKBOX |  |  |  |  |
| `ocr_language` | OCR language | SELECT |  | English; Spanish; French; German; Chinese; Japanese; Other (describe) | ocr_required isTrue | ocr_required isTrue |
| `password_protected_known` | Password-protected files known | CHECKBOX |  |  |  |  |
| `password_source` | Where passwords are held (reference only) | TEXT |  |  | password_protected_known isTrue | password_protected_known isTrue |
| `search_term_prefilter` | Apply search term pre-filter | CHECKBOX |  |  |  |  |
| `search_terms_ref` | Search term list (location or paste) | TEXTAREA |  |  | search_term_prefilter isTrue | search_term_prefilter isTrue |
| `special_instructions` | Special instructions | TEXTAREA |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.3 Relativity Workspace Setup

Create a new Relativity workspace for a Matter.

Example title: *New workspace for 00343-00012*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `workspace_name` | Workspace name | TEXT | Y | Convention: #####-##### - Short matter name |  |  |
| `environment` | Relativity environment | SELECT | Y | Production instance; Secondary / regional instance; Sandbox / test |  |  |
| `template` | Template | SELECT | Y | Standard Review; Early Case Assessment; Production only; Custom (describe) |  |  |
| `template_notes` | Custom template requirements | TEXTAREA |  |  | template = custom_describe | template = custom_describe |
| `users_initial` | Initial users and groups | TEXTAREA | Y | Names and the access level each needs. |  |  |
| `external_users` | External users included (vendor, client, contract reviewers) | CHECKBOX |  |  |  |  |
| `external_users_detail` | External users: organization and end date | TEXTAREA |  |  | external_users isTrue | external_users isTrue |
| `analytics_needed` | Analytics index required | CHECKBOX |  |  |  |  |
| `expected_active_months` | Expected months active | NUMBER |  |  |  |  |
| `layout_requirements` | Layout / coding field requirements | TEXTAREA |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.4 Data Load / Overlay

Load a load file, overlay metadata or load a production into a workspace.

Example title: *Overlay privilege fields from vendor*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `target_workspace` | Target Relativity workspace | ASSET_REF | Y | Asset of type Relativity Workspace in this Matter |  |  |
| `source_asset` | Source data set / production | ASSET_REF | Y |  |  |  |
| `load_type` | Load type | SELECT | Y | Native + metadata (DAT/OPT); Image load; Overlay metadata; Overlay extracted text; Incoming production load |  |  |
| `overlay_key` | Overlay identifier field | TEXT |  |  | load_type in overlay_metadata, overlay_extracted_text | load_type in overlay_metadata, overlay_extracted_text |
| `load_file_location` | Load file location | TEXT | Y |  |  |  |
| `field_mapping_notes` | Field mapping notes | TEXTAREA |  |  |  |  |
| `encoding` | Encoding | SELECT |  | UTF-8; UTF-16; ANSI / Windows-1252; Unknown |  |  |
| `expected_records` | Expected record count | NUMBER | Y |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.5 Search and Culling

Run search terms, hit reports or culling criteria in a workspace.

Example title: *Hit report for revised terms v3*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `target_workspace` | Relativity workspace | ASSET_REF | Y | Asset of type Relativity Workspace in this Matter |  |  |
| `request_kind` | Request kind | SELECT | Y | Search term hit report; Run searches and tag; Date / custodian cull; Domain / email analysis; Other (describe) |  |  |
| `search_terms` | Search terms | TEXTAREA |  | Paste the exact terms and syntax. Version them (v1, v2) in the next field. | request_kind in search_term_hit_report, run_searches_and_tag | request_kind in search_term_hit_report, run_searches_and_tag |
| `terms_version` | Term list version | TEXT |  |  | request_kind in search_term_hit_report, run_searches_and_tag |  |
| `custodians_in_scope` | Custodians in scope | TEXTAREA |  |  |  |  |
| `date_range_start` | Date range start | DATE |  | Leave blank if no start limit. Dates are inclusive. |  |  |
| `date_range_end` | Date range end | DATE |  | Leave blank if no end limit. |  |  |
| `date_basis` | Date field filtered on | SELECT |  | Sent / received; Last modified; Created; Date sent or last modified (either); Not applicable | (date_range_start isNotEmpty OR date_range_end isNotEmpty) | (date_range_start isNotEmpty OR date_range_end isNotEmpty) |
| `include_families` | Include family members | CHECKBOX |  |  |  |  |
| `deliverable` | Deliverable | SELECT | Y | Hit report; Saved search; Both; Tagged documents |  |  |
| `other_description` | Describe the request | TEXTAREA |  |  | request_kind = other_describe | request_kind = other_describe |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.6 Review Setup and Batching

Prepare a workspace for the review team: batches, layouts, saved searches.

Example title: *Batch 4,000 docs for contract reviewers*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `target_workspace` | Relativity workspace | ASSET_REF | Y | Asset of type Relativity Workspace in this Matter |  |  |
| `setup_type` | Setup type | MULTISELECT | Y | Create review batches; Coding layout / fields; Saved searches / views; Reviewer group access; Redaction / privilege setup |  |  |
| `batch_size` | Documents per batch | NUMBER |  |  | setup_type includes create_review_batches | setup_type includes create_review_batches |
| `batch_basis` | Batch by | SELECT |  | Custodian; Date range; Search result; Random; Family group | setup_type includes create_review_batches |  |
| `reviewer_count` | Number of reviewers | NUMBER |  |  |  |  |
| `review_start` | Review start date | DATE |  |  |  |  |
| `review_instructions` | Review protocol location | URL |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.7 Analytics / TAR Setup

Set up analytics (threading, near-dup, clustering) or TAR / continuous active learning.

Example title: *CAL setup for 00343-00012 review*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `target_workspace` | Relativity workspace | ASSET_REF | Y | Asset of type Relativity Workspace in this Matter |  |  |
| `method` | Method | SELECT | Y | Email threading; Near-duplicate / clustering; TAR / continuous active learning; Concept search |  |  |
| `seed_source` | Seed / training set source | TEXT |  |  | method = tar_continuous_active_learning | method = tar_continuous_active_learning |
| `recall_target` | Recall target (%) | NUMBER |  |  | method = tar_continuous_active_learning |  |
| `validation_required` | Validation / elusion testing required | CHECKBOX |  |  | method = tar_continuous_active_learning |  |
| `protocol_reference` | Agreed protocol / court order reference | TEXT |  | Required if a TAR protocol has been negotiated or ordered. |  |  |
| `population_description` | Population / document universe | TEXT |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.8 Production (Outgoing)

Generate an outgoing production volume.

Example title: *PROD004 to opposing counsel*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `source_workspace` | Source workspace | ASSET_REF | Y | Asset of type Relativity Workspace in this Matter |  |  |
| `production_asset` | Production asset (if already registered) | ASSET_REF |  |  |  |  |
| `production_type` | Production type | SELECT | Y | Initial; Rolling; Supplemental; Court-ordered; Regulatory / agency; Copy for client |  |  |
| `produced_to` | Produced to | TEXT | Y |  |  |  |
| `production_set` | Production set / saved search name | TEXT | Y |  |  |  |
| `format` | Format | SELECT | Y | TIFF + load file; Native + load file; Searchable PDF; Mixed (natives for spreadsheets / media) |  |  |
| `bates_prefix` | Bates prefix | TEXT | Y |  |  |  |
| `bates_start` | Starting Bates number | TEXT | Y | Check previous volumes so numbering continues without overlap. |  |  |
| `privilege_screen` | Privilege screen status | SELECT | Y | Complete - cleared by attorney; Pending attorney clearance . Do not start generation until Complete. Clearance is obtained outside MatterFlow. |  |  |
| `privilege_log_needed` | Privilege log required with this volume | CHECKBOX |  |  |  |  |
| `redactions_included` | Redactions included | CHECKBOX |  |  |  |  |
| `redaction_notes` | Redaction types | TEXT |  |  | redactions_included isTrue | redactions_included isTrue |
| `confidentiality_designations` | Confidentiality designations to endorse | CHECKBOX |  |  |  |  |
| `designation_scheme` | Designation scheme / field | TEXT |  |  | confidentiality_designations isTrue | confidentiality_designations isTrue |
| `clawback` | Clawback protection in place | SELECT | Y | FRE 502(d) order; Stipulated agreement; None; Unknown - ask attorney |  |  |
| `delivery_method` | Delivery method | SELECT | Y | Secure file transfer link; Encrypted media shipped; Client portal; Court e-filing; Other |  |  |
| `delivery_notes` | Delivery instructions | TEXTAREA |  |  | delivery_method in encrypted_media_shipped, other | delivery_method = other |
| `send_date` | Date the production must be received | DATE |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.9 Incoming Production Intake

Receive and load a production from another party or a vendor.

Example title: *Receive ABC Corp production vol 2*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `producing_party` | Producing party | TEXT | Y |  |  |  |
| `volume_name` | Volume name / ID | TEXT | Y |  |  |  |
| `bates_range` | Bates range stated | TEXT |  |  |  |  |
| `received_via` | Received via | SELECT | Y | Secure link; Physical media; Email; Other |  |  |
| `media_asset` | Physical media asset | ASSET_REF |  |  | received_via = physical_media | received_via = physical_media |
| `encrypted` | Encrypted | CHECKBOX |  |  |  |  |
| `password_location` | Where password is held (reference only) | TEXT |  |  | encrypted isTrue | encrypted isTrue |
| `load_file_included` | Load file included | SELECT | Y | Yes (DAT/OPT); Yes (other format); No - loose files only |  |  |
| `cover_letter_summary` | Cover letter summary | TEXTAREA |  | Counts and any stated deficiencies. The letter itself is not stored. |  |  |
| `completeness_check` | Check completeness against cover letter | CHECKBOX |  |  |  |  |
| `target_workspace` | Target workspace (if known) | ASSET_REF |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.10 Harvey Vault Request

Create, populate, share or retire a Harvey vault.

Example title: *Harvey vault for diligence documents*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `request_type` | Request | SELECT | Y | Create vault; Add / remove users; Import data from workspace or data set; Export results; Retire / delete vault |  |  |
| `vault_asset` | Existing vault | ASSET_REF |  |  | request_type != create_vault | request_type != create_vault |
| `vault_purpose` | Purpose | SELECT |  | Document analysis; Contract / diligence review; Deposition / testimony prep; Research workspace; Other | request_type = create_vault |  |
| `client_ai_use_confirmed` | Client permission for AI tool use | SELECT |  | Confirmed permitted; Not yet confirmed; Client prohibits . Check the client's outside counsel guidelines first. | request_type in create_vault, import_data_from_workspace_or_data_set | request_type in create_vault, import_data_from_workspace_or_data_set |
| `source_asset` | Source workspace / data set | ASSET_REF |  |  | request_type = import_data_from_workspace_or_data_set | request_type = import_data_from_workspace_or_data_set |
| `users_detail` | Users to add / remove | TEXTAREA |  |  | request_type = add_remove_users | request_type = add_remove_users |
| `expected_files` | Approx. number of files | NUMBER |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.11 Physical Media Custody Event

Log one custody event (receipt, check-out, shipment, return, destruction) for a Physical Media asset. One Task per event, so the history is a chain of custody.

Example title: *Check out drive 00343-00012-M003*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `media_asset` | Physical media asset | ASSET_REF | Y |  |  |  |
| `event_type` | Event | SELECT | Y | Received at firm; Checked out internally; Checked back in; Shipped to vendor; Returned to client / custodian; Destroyed; Sent for forensic imaging |  |  |
| `event_datetime` | Event date and time | DATETIME | Y |  |  |  |
| `from_party` | Released by | TEXT | Y |  |  |  |
| `to_party` | Received by | TEXT | Y |  |  |  |
| `condition` | Condition / seal | SELECT | Y | Sealed and intact; Unsealed; Visibly damaged; Not inspected |  |  |
| `seal_number` | Seal / bag number | TEXT |  |  |  |  |
| `storage_location` | New storage location | TEXT |  |  | event_type in received_at_firm, checked_back_in | event_type in received_at_firm, checked_back_in |
| `carrier` | Carrier | TEXT |  |  | event_type in shipped_to_vendor, returned_to_client_custodian |  |
| `tracking_number` | Tracking number | TEXT |  |  | event_type in shipped_to_vendor, returned_to_client_custodian | event_type in shipped_to_vendor |
| `signed_receipt` | Signed receipt obtained | CHECKBOX |  |  |  |  |
| `destruction_method` | Destruction method | SELECT |  | Shredded; Degaussed and shredded; Cryptographic erase; Vendor destruction | event_type = destroyed | event_type = destroyed |
| `destruction_witness` | Witness | TEXT |  |  | event_type = destroyed | event_type = destroyed |
| `certificate_ref` | Certificate / receipt reference | TEXT |  |  | event_type in destroyed, returned_to_client_custodian | event_type = destroyed |
| `authorized_by` | Authorized by (attorney or client contact) | TEXT |  |  | event_type in destroyed, returned_to_client_custodian | event_type in destroyed, returned_to_client_custodian |

### 7.12 Access Request

Add, remove or review user access to a workspace or vault.

Example title: *Add 6 contract reviewers to review workspace*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `target_asset` | Workspace or vault | ASSET_REF | Y |  |  |  |
| `access_action` | Action | SELECT | Y | Add user(s); Remove user(s); Change permission group; Periodic access review |  |  |
| `users_detail` | Users (name, email, firm / organization) | TEXTAREA |  |  | access_action != periodic_access_review | access_action != periodic_access_review |
| `user_type` | User type | SELECT |  | Firm attorney / staff; Contract reviewer; Client personnel; Vendor / consultant; Co-counsel / other firm | access_action = add_user_s | access_action = add_user_s |
| `access_level` | Access level | SELECT |  | Reviewer; Reviewer with export; Case team admin; Read only | access_action in add_user_s, change_permission_group | access_action in add_user_s, change_permission_group |
| `access_end_date` | Access end date | DATE |  |  | user_type in contract_reviewer, client_personnel, vendor_consultant, co_counsel_other_firm | user_type in contract_reviewer, client_personnel, vendor_consultant, co_counsel_other_firm |
| `nda_on_file` | Confidentiality agreement on file | CHECKBOX |  |  | user_type in contract_reviewer, client_personnel, vendor_consultant, co_counsel_other_firm | user_type in contract_reviewer, client_personnel, vendor_consultant, co_counsel_other_firm |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |

### 7.13 Export / Transfer

Export data from a workspace or data set and transfer it to a client, vendor, expert or other party.

Example title: *Export workspace to client*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `source_asset` | Source workspace / data set | ASSET_REF | Y |  |  |  |
| `recipient` | Recipient (name / organization) | TEXT | Y |  |  |  |
| `recipient_type` | Recipient type | SELECT | Y | Client; Co-counsel; Vendor; Expert / consultant; Court / agency; Other |  |  |
| `authorized_by` | Authorized by (attorney) | TEXT | Y | Name of the attorney who authorized this transfer. Authorization happens outside MatterFlow. |  |  |
| `content` | Content to export | SELECT | Y | Native files; Images + load file; Reports only; Full workspace export; Other (describe) |  |  |
| `content_notes` | Describe content | TEXTAREA |  |  | content = other_describe | content = other_describe |
| `includes_privileged` | Includes privileged / work-product material | CHECKBOX |  |  |  |  |
| `privileged_basis` | Basis for including (e.g. transfer to client) | TEXT |  |  | includes_privileged isTrue | includes_privileged isTrue |
| `transfer_method` | Transfer method | SELECT | Y | Secure file transfer link; Encrypted media shipped; Client portal; Other |  |  |
| `estimated_gb` | Estimated size (GB) | NUMBER |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `handling_notes` | Handling instructions | TEXTAREA |  | Who may see this data, any segregation required, where the protocol is documented. No privileged content. | (handling_flags includes contains_privileged_material OR handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) | (handling_flags includes highly_confidential_attorneys_eyes_only OR handling_flags includes foreign_cross_border_data) |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
| `deadline_note` | Deadline details | TEXT |  | Cite the order, paragraph, hearing date or meet-and-confer date. Do not paste privileged analysis. | deadline_driver != internal_target_only | deadline_driver in court_order_court_deadline, regulatory_agency_deadline, stipulation_with_opposing_party |

### 7.14 Archive and Disposition

Archive, restore, delete or return data; certified destruction at matter close.

Example title: *Archive 00343-00012 workspace*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `target_asset` | Workspace / data set / vault / media | ASSET_REF | Y |  |  |  |
| `action` | Action | SELECT | Y | Archive; Restore from archive; Delete; Return to client; Certified destruction |  |  |
| `matter_closed_confirmed` | Matter closure confirmed | SELECT | Y | Confirmed closed by attorney; Pending; Not applicable |  |  |
| `legal_hold_check` | Legal hold check | SELECT |  | Confirmed no hold applies; Hold in place - DO NOT DELETE; Unknown | action in delete, return_to_client, certified_destruction | action in delete, return_to_client, certified_destruction |
| `authorized_by` | Authorized by | TEXT |  |  | action in delete, return_to_client, certified_destruction | action in delete, return_to_client, certified_destruction |
| `certificate_needed` | Certificate of destruction / return required | CHECKBOX |  |  | action in delete, return_to_client, certified_destruction |  |
| `retention_basis` | Retention policy / OCG reference | TEXT |  |  |  |  |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |

### 7.15 General / Ad Hoc Request

Anything that does not fit another type: questions, reports, tool issues, training.

Example title: *How do I redact a native spreadsheet?*

| Key | Label | Type | Req | Options / notes | Show when | Required when |
|---|---|---|---|---|---|---|
| `category` | Category | SELECT | Y | Question / consult; Report request; Tool or workspace issue; Training; Other |  |  |
| `details_needed` | What is needed | TEXTAREA | Y |  |  |  |
| `related_asset` | Related asset | ASSET_REF |  |  |  |  |
| `handling_flags` | Handling flags | MULTISELECT |  | Contains privileged material; Contains PII / PHI; Highly confidential / Attorneys' Eyes Only; Foreign / cross-border data; Protective order applies; None known . Flags only. Do not describe privileged content in titles, descriptions or comments. |  |  |
| `deadline_driver` | What is driving the due date? | SELECT | Y | Internal target only; Court order / court deadline; Regulatory / agency deadline; Stipulation with opposing party; Client-imposed deadline; Other . Task Due Date is the date work must be DONE. If an external deadline exists, record its source here. |  |  |
## 8. Notes for the developer adapting this seed

1. `ASSET_REF` fields used inside Asset Type forms (e.g. `source_media`, `source_workspace`) reference another Asset in the same Matter; the engine already forbids cross-Matter references.
2. The Physical Media `custody_status_note` field exists only so the disposition fields can use a conditional rule. If the Asset's own status (In custody, Checked out, At vendor, Returned, Destroyed) can drive conditional rules in the form engine, drop it and key off Asset status instead.
3. Defaults expressed as `"default": "<optionKey>"` or `true/false` in the JSON.
4. Rules are shown in the JSON with the exact `{op, field, value}` / `{op:"or", args:[...]}` shapes of `form-rules.schema.json`.
5. Workflow `skippable` / `skipCommentRequired` map to the per-placement step settings (architecture 8.1).
6. The seed Client `00001` / Matter `00001` is an example; replace with the firm's real internal client number or omit.
7. The same DEADLINE and HANDLING blocks are repeated in each Task Type form on purpose: forms are independent versioned objects, and admins may drop them per type.
