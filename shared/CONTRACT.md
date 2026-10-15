# Backend contract

`shared/design.js` is implemented. Import `DEFAULT_DESIGN`, `MATERIALS` (object keyed by material), `PRESETS` (array with `id,name,label,description,design`), `DesignSchema`, `applyLocks`, `changedFields`, `getDesignWarnings`.

Design matches the INITIAL delegated specification:

```json
{"name":"暖调 · 奶油边柜","width":1.6,"height":0.8,"depth":0.44,"doors":4,"cornerRadius":0.055,"legStyle":"round","legHeight":0.14,"bodyMaterial":"cream","doorMaterial":"cream","topMaterial":"oak","handleStyle":"none","detail":"fluted","style":"soft"}
```

Units are metres. `legStyle`: plinth,round,tapered,floating. `handleStyle`: none,brass,wood. `detail`: plain,fluted. `style`: soft,minimal,natural. Body/door materials: cream,oak,walnut,sage,charcoal. Top also supports travertine.

- GET `/api/health` -> `{mode:'demo'|'ai',provider,model}`
- POST `/api/design` accepts BOTH `{message,design,locked}` and `{prompt,currentDesign,locks}`. `locked` or `locks` is array of shape,material,detail. Optional history role/content pairs. Response `{design,reply,message,mode,changes:string[],warnings:string[]}`. `message` aliases `reply`.
- GET `/api/versions` -> `{versions:[{id,name,createdAt,design}]}`
- POST `/api/versions` `{name,design}` -> `{version}`
- DELETE `/api/versions/:id` -> `{deleted:true}`
- POST `/api/confirm` `{design}` -> attachment JSON appearance-confirmation.json.

Server command `node server/index.js`; bind `127.0.0.1:8787`; optional AI_BASE_URL,AI_API_KEY,AI_MODEL in `.env`; absent credentials -> explicitly rule-based demo. Dependencies express,zod,dotenv.
