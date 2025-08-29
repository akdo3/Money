/* ===========================
     IndexedDB setup with Dexie
     =========================== */
  const db = new Dexie("finance_manager_db_v1");
  db.version(1).stores({
    accounts: "++id,name,type,currency,balance",
    transactions: "++id,date,amount,type,accountId,categoryId,tags,relatedDebtorId",
    categories: "++id,name,parentId",
    budgets: "++id,categoryId,periodType,amount",
    debtors: "++id,name",
    debtItems: "++id,debtorId,description,principal,dueDate",
    payments: "++id, debtItemId, amount, date",
    recurring: "++id, nextRunDate, frequency",
    goals: "++id,title,targetAmount,currentAmount,targetDate",
    settings: "id" ,
    audit: "++id,action,timestamp"
  });

  // default settings if none
  async function ensureDefaultSettings(){
    const s = await safeGet('settings', 1);
    if(!s){
      await db.settings.put({id:1, currency:'EGP', locale:'ar-EG', encrypt:false});
    }
  }
  ensureDefaultSettings();
  
  /* ===========================
     Utility helpers
     =========================== */
  function $ (sel, ctx=document) { return ctx.querySelector(sel); }
  function $$ (sel, ctx=document) { return ctx.querySelector(sel); }
  function $$$ (sel, ctx=document) { return Array.from(ctx.querySelectorAll(sel)); }
  function fmtMoney(v,currency='EGP'){ return (Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ' + currency; }
  function uid(){ return 'id-'+Math.random().toString(36).slice(2,12); }
  function toast(msg, t=2500){
    const el = $$('#toast'); el.textContent = msg; el.style.display='block';
    setTimeout(()=>el.style.display='none', t);
  }
  async function audit(action, note=''){
    await db.audit.add({action, note, timestamp: new Date().toISOString()});
  }
  
  // validate DB keys: only positive integer IDs are considered valid keys for .get()
  function isValidId(k){
    if (k === undefined || k === null) return false;
    const n = Number(k);
    return Number.isInteger(n) && n > 0;
  }
  
  // safe helper to avoid calling IDB .get with invalid/undefined keys
  async function safeGet(table, id){
    // if table not supplied, assume settings
    if (!table) table = 'settings';
    // default settings id to 1 when asking for settings without id
    if (table === 'settings' && (id === undefined || id === null)) id = 1;
    if (!isValidId(id)) return null;
    if (!db || !db[table]) return null;
    try { return await db[table].get(Number(id)); } catch(e){
      console.warn('safeGet error', table, id, e);
      return null;
    }
  }
  /* ===========================
     View navigation
     =========================== */
  const views = ['dashboard','transactions','accounts','categories','debtors','goals','reports','settings'];
  const navButtons = Array.from(document.querySelectorAll('#nav button'));
  navButtons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      navButtons.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      showView(btn.dataset.view);
    });
  });
  function showView(name){
    views.forEach(v=>{
      const s = $(`#view-${v}`);
      if(s) s.style.display = (v===name)?'block':'none';
    });
    if(name==='dashboard') renderDashboard();
    if(name==='transactions') renderTransactions();
    if(name==='accounts') renderAccounts();
    if(name==='categories') renderCategories();
    if(name==='debtors') renderDebtors();
    if(name==='goals') renderGoals();
    if(name==='reports') renderReports();
    if(name==='settings') renderSettings();
  }

  /* ===========================
     Dashboard rendering
     =========================== */
  async function renderDashboard(){
    // totals
    const accounts = await db.accounts.toArray();
    const totalBalance = accounts.reduce((s,a)=>s + (Number(a.balance)||0), 0);
    $$('#total-balance').textContent = fmtMoney(totalBalance, (await safeGet('', )).currency || 'EGP');

    // debts
    const debtItems = await db.debtItems.toArray();
    const payments = await db.payments.toArray();
    const debtSummary = debtItems.map(d=>{
      const paid = payments.filter(p=>p.debtItemId===d.id).reduce((s,p)=>s+Number(p.amount||0),0);
      return {id:d.id, owed:Number(d.principal||0), paid};
    });
    const outstanding = debtSummary.reduce((s,i)=>s + Math.max(0,i.owed - i.paid),0);
    $$('#outstanding-debts').textContent = fmtMoney(outstanding, (await safeGet('', )).currency || 'EGP');
    $$('#badge-debts').textContent = debtItems.length;

    // spend 30 days
    const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate()-30);
    const txns30 = await db.transactions.where('date').above(thirtyAgo.toISOString()).toArray();
    const spend30 = txns30.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);
    $$('#spend-30').textContent = fmtMoney(spend30, (await safeGet('', )).currency || 'EGP');

    // accounts widget
    const accList = $$('#accounts-list'); accList.innerHTML='';
    accounts.slice(0,5).forEach(a=>{
      const el = document.createElement('div'); el.style.display='flex'; el.style.justifyContent='space-between'; el.style.marginBottom='8px';
      el.innerHTML = `<div><strong>${a.name}</strong><div class="small">${a.type}</div></div><div style="text-align:left">${fmtMoney(a.balance,a.currency)}</div>`;
      accList.appendChild(el);
    });

    // debtors widget
    const debtWidget = $$('#debtors-widget'); debtWidget.innerHTML='';
    const debtors = await db.debtors.toArray();
    // compute due soon (within 7 days)
    const soon = [];
    const now = new Date();
    const week = new Date(); week.setDate(now.getDate()+7);
    for(const d of debtItems){
      if(d.dueDate){
        const dd = new Date(d.dueDate);
        if(dd >= now && dd <= week){
          const debtor = debtors.find(x=>x.id===d.debtorId);
          soon.push({debt:d, debtor});
        }
      }
    }
    if(soon.length===0) debtWidget.textContent='لا ديون قريبة من الاستحقاق';
    else {
      soon.slice(0,5).forEach(s=>{
        const el = document.createElement('div'); el.style.marginBottom='8px';
        el.innerHTML = `<div style="display:flex;justify-content:space-between"><div><strong>${s.debtorId? (s.debtor? s.debtor.name : 'مدين') : 'غير مرتبط'}</strong><div class="small">${s.debt.description || ''}</div></div><div class="small">${new Date(s.debt.dueDate).toLocaleDateString()}</div></div>`;
        debtWidget.appendChild(el);
      });
    }

    // alerts: overdue debts or budget breaches
    const alertsEl = $$('#alerts'); alertsEl.innerHTML='';
    const overdue = debtItems.filter(d=>{
      return d.dueDate && new Date(d.dueDate) < new Date() && (payments.filter(p=>p.debtItemId===d.id).reduce((s,p)=>s+p.amount||0,0) < Number(d.principal||0));
    });
    for(const d of overdue){
      const debtor = (await safeGet('debtors', d.debtorId)) || {name:'غير معروف'};
      const el = document.createElement('div');
      el.className='badge danger';
      el.style.display='block'; el.style.marginBottom='8px';
      el.textContent = `دين متأخر: ${debtor.name} — ${fmtMoney(d.principal - (payments.filter(p=>p.debtItemId===d.id).reduce((s,p)=>s+p.amount||0,0)||0))}`;
      alertsEl.appendChild(el);
    }
    // chart: simple monthly totals for last 12 months
    renderCashFlowChart();
  }

  let flowChart = null;
  async function renderCashFlowChart(){
    const ctx = document.getElementById('chart-flow').getContext('2d');
    // prepare last 12 months labels
    const months = []; const dataIncome = []; const dataExpense = [];
    const now = new Date();
    for(let i=11;i>=0;i--){
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      months.push(d.toLocaleString((await safeGet('', )).locale || 'ar-EG',{month:'short', year:'2-digit'}));
      dataIncome.push(0); dataExpense.push(0);
    }
    const txns = await db.transactions.toArray();
    txns.forEach(t=>{
      const d = new Date(t.date);
      const idx = (now.getFullYear()-d.getFullYear())*12 + (now.getMonth()-d.getMonth());
      const pos = 11 - idx;
      if(pos>=0 && pos<12){
        if(t.type==='income') dataIncome[pos] += Number(t.amount||0);
        if(t.type==='expense') dataExpense[pos] += Number(t.amount||0);
      }
    });
    const datasets = [
      {label:'دخل', data:dataIncome, tension:0.35, fill:true},
      {label:'مصاريف', data:dataExpense, tension:0.35, fill:true}
    ];
    if(flowChart) flowChart.destroy();
    flowChart = new Chart(ctx, {
      type:'line',
      data:{labels:months, datasets},
      options:{
        plugins:{legend:{display:true, labels:{color:'#e6eef8'}}},
        scales:{x:{ticks:{color:'#cbd5e1'}}, y:{ticks:{color:'#cbd5e1'}}}
      }
    });
  }

  /* ===========================
     Transactions CRUD UI
     =========================== */
  $$('#add-transaction').addEventListener('click', ()=>openTxnModal());
  $$('#quick-add-txn').addEventListener('click', ()=>{ document.querySelector('[data-view="transactions"]').click(); openTxnModal(); });

  // ...existing code...
  // ...existing code...
  async function renderTransactions(){
    try {
      const body = $$('#txns-table-body'); body.innerHTML='';
      const txns = await db.transactions.orderBy('date').reverse().toArray();
      const settings = await safeGet('', );
      const currency = (settings && settings.currency) ? settings.currency : 'EGP';
      for(const t of txns){
        let acc = null, cat = null;
        try {
          acc = await safeGet('accounts', t.accountId);
        } catch(e){
          console.warn('failed to get account for txn', t && t.id, e);
          acc = null;
        }
        try {
          cat = await safeGet('categories', t.categoryId);
        } catch(e){
          console.warn('failed to get category for txn', t && t.id, e);
          cat = null;
        }
        const tr = document.createElement('tr');
        const dateStr = new Date(t.date).toLocaleString();
        tr.innerHTML = `<td>${dateStr}</td><td>${t.note||t.description||''}</td><td>${cat?cat.name:''}</td><td>${acc?acc.name:''}</td><td style="text-align:left">${fmtMoney(t.amount,currency)}</td><td><div class="table-actions"><button class="btn ghost" data-id="${t.id}" data-act="edit">تعديل</button><button class="btn ghost" data-id="${t.id}" data-act="delete">حذف</button></div></td>`;
        body.appendChild(tr);
      }
      body.querySelectorAll('button[data-act="delete"]').forEach(b=>{
        b.addEventListener('click', async (e)=>{
          const id = Number(b.dataset.id);
          if(!confirm('هل أنت متأكد من حذف العملية؟')) return;
          await db.transactions.delete(id);
          await audit('delete-transaction', String(id));
          renderTransactions(); renderDashboard();
          toast('تم حذف العملية');
        });
      });
      body.querySelectorAll('button[data-act="edit"]').forEach(b=>{
        b.addEventListener('click', async ()=>{
          const id = Number(b.dataset.id);
          const t = await safeGet('transactions', id);
          openTxnModal(t);
        });
      });
    } catch (err) {
      console.error('renderTransactions error', err);
      const body = $$('#txns-table-body');
      if(body) body.innerHTML = '<tr><td colspan="6" class="muted">حدث خطأ أثناء تحميل العمليات</td></tr>';
    }
  }

  /* Transaction modal */
  async function openTxnModal(txn=null){
    const modal = $$('#modal'); const backdrop = $$('#modal-backdrop');
    modal.innerHTML = `
      <h3>${txn? 'تعديل عملية' : 'إضافة عملية'}</h3>
      <div style="margin-top:8px">
        <label>النوع:
          <select id="m-type">
            <option value="expense">مصاريف</option>
            <option value="income">دخل</option>
            <option value="transfer">تحويل</option>
          </select>
        </label>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="col"><label>المبلغ <input id="m-amount" type="number" step="0.01"/></label></div>
        <div class="col"><label>التاريخ <input id="m-date" type="datetime-local"/></label></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="col"><label>الحساب <select id="m-account"></select></label></div>
        <div class="col"><label>فئة <select id="m-category"></select></label></div>
      </div>
      <div style="margin-top:8px"><label>المدين (اختياري) <select id="m-debtor"><option value="">--لا يوجد--</option></select></label></div>
      <div style="margin-top:8px"><label>ملاحظة<textarea id="m-note"></textarea></label></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" id="m-cancel">إلغاء</button><button class="btn" id="m-save">حفظ</button></div>
    `;
    // populate selects
    const accounts = await db.accounts.toArray();
    const cats = await db.categories.toArray();
    const debtors = await db.debtors.toArray();
    const accSel = modal.querySelector('#m-account'); accSel.innerHTML='';
    accounts.forEach(a=>{ const o = document.createElement('option'); o.value=a.id; o.textContent = a.name; accSel.appendChild(o);});
    const catSel = modal.querySelector('#m-category'); catSel.innerHTML='<option value="">--بدون--</option>';
    cats.forEach(c=>{ const o = document.createElement('option'); o.value=c.id; o.textContent = c.name; catSel.appendChild(o);});
    const debtorSel = modal.querySelector('#m-debtor'); debtorSel.innerHTML='<option value="">--لا يوجد--</option>';
    debtors.forEach(d=>{ const o = document.createElement('option'); o.value=d.id; o.textContent = d.name; debtorSel.appendChild(o); });

    // fill if editing
    if(txn){
      modal.querySelector('#m-type').value = txn.type;
      modal.querySelector('#m-amount').value = txn.amount;
      modal.querySelector('#m-date').value = new Date(txn.date).toISOString().slice(0,16);
      modal.querySelector('#m-account').value = txn.accountId;
      modal.querySelector('#m-category').value = txn.categoryId || '';
      modal.querySelector('#m-debtor').value = txn.relatedDebtorId || '';
      modal.querySelector('#m-note').value = txn.note || '';
    } else {
      modal.querySelector('#m-date').value = new Date().toISOString().slice(0,16);
    }

    backdrop.style.display='flex';
    modal.classList.add('open');
    modal.querySelector('#m-cancel').addEventListener('click', ()=>{ backdrop.style.display='none'; modal.classList.remove('open');});
    modal.querySelector('#m-save').addEventListener('click', async ()=>{
      const type = modal.querySelector('#m-type').value;
      const amount = Number(modal.querySelector('#m-amount').value || 0);
      const date = new Date(modal.querySelector('#m-date').value).toISOString();
      const accountVal = modal.querySelector('#m-account').value;
      const accountId = accountVal ? Number(accountVal) : null;
      const categoryVal = modal.querySelector('#m-category').value;
      const categoryId = categoryVal ? Number(categoryVal) : null;
      const relatedDebtorVal = modal.querySelector('#m-debtor').value;
      const relatedDebtorId = relatedDebtorVal ? Number(relatedDebtorVal) : null;
      const note = modal.querySelector('#m-note').value;
      if(amount<=0){ alert('أدخل مبلغاً صالحاً'); return; }
      if(!accountId && type!=='transfer'){ alert('اختر حساباً'); return; }
      if(txn){
        await db.transactions.update(txn.id,{type,amount,date,accountId,categoryId,relatedDebtorId,note});
        await audit('update-transaction', String(txn.id));
      } else {
        const id = await db.transactions.add({date, amount, type, accountId, categoryId, tags:[], relatedDebtorId, note});
        await audit('create-transaction', String(id));
        // update account balance
        if (isValidId(accountId)) {
          const acc = await safeGet('accounts', accountId);
           if(acc){
             let bal = Number(acc.balance||0);
             if(type==='expense') bal -= amount;
             if(type==='income') bal += amount;
             await db.accounts.update(accountId, {balance: bal});
           }
         }
      }
      backdrop.style.display='none'; modal.classList.remove('open');
      renderTransactions(); renderDashboard();
      toast('تم حفظ العملية');
    });
  }

  /* ===========================
     Accounts CRUD
     =========================== */
  $$('#add-account').addEventListener('click', ()=>openAccountModal());
  async function renderAccounts(){
    const body = $$('#accounts-table-body'); body.innerHTML='';
    const list = await db.accounts.toArray();
    for(const a of list){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${a.name}</td><td>${a.type}</td><td>${fmtMoney(a.balance,a.currency)}</td><td><div class="table-actions"><button class="btn ghost" data-id="${a.id}" data-act="edit-acc">تعديل</button><button class="btn ghost" data-id="${a.id}" data-act="del-acc">حذف</button></div></td>`;
      body.appendChild(tr);
    }
    body.querySelectorAll('button[data-act="del-acc"]').forEach(b=>{
      b.addEventListener('click', async ()=>{
        if(!confirm('حذف الحساب سيؤثر على سجلاته. متابعة؟')) return;
        await db.accounts.delete(Number(b.dataset.id));
        await audit('delete-account', b.dataset.id);
        renderAccounts(); renderDashboard();
      });
    });
    body.querySelectorAll('button[data-act="edit-acc"]').forEach(b=>{
      b.addEventListener('click', async ()=> openAccountModal(await safeGet('accounts', Number(b.dataset.id))));
    });
  }

  async function openAccountModal(acc=null){
    const modal = $$('#modal'); const backdrop = $$('#modal-backdrop');
    modal.innerHTML = `
      <h3>${acc? 'تعديل حساب' : 'إضافة حساب'}</h3>
      <div style="margin-top:8px"><label>الاسم <input id="a-name" /></label></div>
      <div class="row" style="margin-top:8px"><div class="col"><label>النوع <input id="a-type" value="نقد"/></label></div><div class="col"><label>العملة <input id="a-currency" value="${(await safeGet('', )).currency || 'EGP'}"/></label></div></div>
      <div style="margin-top:8px"><label>الرصيد الأولي <input id="a-balance" type="number" step="0.01" value="0"/></label></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" id="a-cancel">إلغاء</button><button class="btn" id="a-save">حفظ</button></div>
    `;
    if(acc){
      modal.querySelector('#a-name').value = acc.name;
      modal.querySelector('#a-type').value = acc.type;
      modal.querySelector('#a-currency').value = acc.currency;
      modal.querySelector('#a-balance').value = acc.balance;
    }
    backdrop.style.display='flex'; modal.classList.add('open');
    modal.querySelector('#a-cancel').addEventListener('click', ()=>{ backdrop.style.display='none'; modal.classList.remove('open');});
    modal.querySelector('#a-save').addEventListener('click', async ()=>{
      const name = modal.querySelector('#a-name').value.trim();
      const type = modal.querySelector('#a-type').value.trim();
      const currency = modal.querySelector('#a-currency').value.trim() || 'EGP';
      const balance = Number(modal.querySelector('#a-balance').value||0);
      if(!name){ alert('أدخل اسم الحساب'); return; }
      if(acc){
        await db.accounts.update(acc.id,{name,type,currency,balance});
        await audit('update-account', String(acc.id));
      } else {
        const id = await db.accounts.add({name,type,currency,balance});
        await audit('create-account', String(id));
      }
      backdrop.style.display='none'; modal.classList.remove('open');
      renderAccounts(); renderDashboard();
      toast('تم حفظ الحساب');
    });
  }

  /* ===========================
     Categories & Budgets
     =========================== */
  $$('#add-category').addEventListener('click', ()=>openCategoryModal());
  async function renderCategories(){
    const body = $$('#categories-table-body'); body.innerHTML='';
    const cats = await db.categories.toArray();
    const budgets = await db.budgets.toArray();
    for(const c of cats){
      const bud = budgets.find(b=>b.categoryId===c.id);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${c.name}</td><td>${bud? fmtMoney(bud.amount,(await safeGet('', )).currency) : '-'}</td><td><div class="progress"><i style="width: ${Math.min(100, Math.floor(Math.random()*80))}%"></i></div></td><td><div class="table-actions"><button class="btn ghost" data-id="${c.id}" data-act="edit-cat">تعديل</button><button class="btn ghost" data-id="${c.id}" data-act="del-cat">حذف</button></div></td>`;
      body.appendChild(tr);
    }
    body.querySelectorAll('button[data-act="del-cat"]').forEach(b=>{
      b.addEventListener('click', async ()=>{
        if(!confirm('حذف الفئة؟ ستفقد ربط العمليات بها.')) return;
        await db.categories.delete(Number(b.dataset.id));
        await audit('delete-category', b.dataset.id);
        renderCategories();
      });
    });
    body.querySelectorAll('button[data-act="edit-cat"]').forEach(b=>{
      b.addEventListener('click', async ()=> openCategoryModal(await safeGet('categories', Number(b.dataset.id))));
    });
  }

  async function openCategoryModal(cat=null){
    const modal = $$('#modal'); const backdrop = $$('#modal-backdrop');
    modal.innerHTML = `<h3>${cat? 'تعديل فئة' : 'إضافة فئة'}</h3>
      <div style="margin-top:8px"><label>اسم الفئة <input id="c-name" /></label></div>
      <div style="margin-top:8px"><label>ميزانية شهرية (اختياري) <input id="c-budget" type="number" step="0.01" /></label></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" id="c-cancel">إلغاء</button><button class="btn" id="c-save">حفظ</button></div>`;
    if(cat) modal.querySelector('#c-name').value = cat.name;
    backdrop.style.display='flex'; modal.classList.add('open');
    modal.querySelector('#c-cancel').addEventListener('click', ()=>{ backdrop.style.display='none'; modal.classList.remove('open');});
    modal.querySelector('#c-save').addEventListener('click', async ()=>{
      const name = modal.querySelector('#c-name').value.trim();
      const budgetVal = Number(modal.querySelector('#c-budget').value||0);
      if(!name){ alert('أدخل اسم الفئة'); return; }
      if(cat){
        await db.categories.update(cat.id,{name});
        if(budgetVal>0){
          const b = (await db.budgets.where('categoryId').equals(cat.id).first());
          if(b) await db.budgets.update(b.id,{amount:budgetVal});
          else await db.budgets.add({categoryId:cat.id,periodType:'monthly',amount:budgetVal});
        }
        await audit('update-category', String(cat.id));
      } else {
        const id = await db.categories.add({name});
        if(budgetVal>0) await db.budgets.add({categoryId:id, periodType:'monthly', amount:budgetVal});
        await audit('create-category', String(id));
      }
      backdrop.style.display='none'; modal.classList.remove('open');
      renderCategories(); toast('تم حفظ الفئة');
    });
  }

  /* ===========================
     Debtors & Debt Items & Payments
     =========================== */
  $$('#btn-add-debtor').addEventListener('click', ()=>openDebtorModal());
  $$('#quick-add-debtor').addEventListener('click', ()=>{ document.querySelector('[data-view="debtors"]').click(); openDebtorModal(); });

  async function renderDebtors(){
    const body = $$('#debtors-table-body'); body.innerHTML='';
    const debtors = await db.debtors.toArray();
    const debtItems = await db.debtItems.toArray();
    const payments = await db.payments.toArray();
    for(const d of debtors){
      const items = debtItems.filter(i=>i.debtorId === d.id);
      const totalOwed = items.reduce((s,i)=>s + Number(i.principal||0),0);
      const totalPaid = payments.filter(p=> items.some(it=>it.id===p.debtItemId)).reduce((s,p)=>s + Number(p.amount||0),0);
      const left = totalOwed - totalPaid;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${d.name}</td><td>${fmtMoney(totalOwed,(await safeGet('', )).currency)}</td><td>${fmtMoney(totalPaid,(await safeGet('', )).currency)}</td><td>${fmtMoney(left,(await safeGet('', )).currency)}</td><td><div class="table-actions"><button class="btn" data-id="${d.id}" data-act="open-debtor">عرض</button><button class="btn ghost" data-id="${d.id}" data-act="del-debtor">حذف</button></div></td>`;
      body.appendChild(tr);
    }
    body.querySelectorAll('button[data-act="open-debtor"]').forEach(b=>{
      b.addEventListener('click', async ()=> openDebtorDetailModal(Number(b.dataset.id)));
    });
    body.querySelectorAll('button[data-act="del-debtor"]').forEach(b=>{
      b.addEventListener('click', async ()=>{
        if(!confirm('حذف المدين سيحذف سجلات الديون المرتبطة. متابعة؟')) return;
        await db.debtors.delete(Number(b.dataset.id));
        await db.debtItems.where('debtorId').equals(Number(b.dataset.id)).delete();
        await audit('delete-debtor', b.dataset.id);
        renderDebtors(); renderDashboard();
      });
    });
  }

  async function openDebtorModal(debtor=null){
    const modal = $$('#modal'), backdrop = $$('#modal-backdrop');
    modal.innerHTML = `<h3>${debtor? 'تعديل مدين' : 'إضافة مدين'}</h3>
      <div style="margin-top:8px"><label>الاسم <input id="d-name" /></label></div>
      <div style="margin-top:8px"><label>ملاحظات<textarea id="d-notes"></textarea></label></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" id="d-cancel">إلغاء</button><button class="btn" id="d-save">حفظ</button></div>`;
    if(debtor){
      modal.querySelector('#d-name').value = debtor.name;
    }
    backdrop.style.display='flex'; modal.classList.add('open');
    modal.querySelector('#d-cancel').addEventListener('click', ()=>{ backdrop.style.display='none'; modal.classList.remove('open');});
    modal.querySelector('#d-save').addEventListener('click', async ()=>{
      const name = modal.querySelector('#d-name').value.trim();
      const notes = modal.querySelector('#d-notes').value;
      if(!name){ alert('أدخل اسم المدين'); return; }
      if(debtor){
        await db.debtors.update(debtor.id,{name,notes});
        await audit('update-debtor', String(debtor.id));
      } else {
        const id = await db.debtors.add({name,notes});
        await audit('create-debtor', String(id));
      }
      backdrop.style.display='none'; modal.classList.remove('open');
      renderDebtors(); renderDashboard();
      toast('تم حفظ المدين');
    });
  }

  async function openDebtorDetailModal(debtorId){
    const debtor = await safeGet('debtors', debtorId) || {name:'غير معروف'};
    const modal = $$('#modal'), backdrop = $$('#modal-backdrop');
    modal.innerHTML = `<h3>المدين: ${debtor.name}</h3>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="add-debt">إضافة دين</button><button class="btn ghost" id="add-payment">تسجيل دفعة</button><button class="btn ghost" id="print-debtor">طباعة</button></div>
      <div id="debtor-detail-area" style="margin-top:12px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" id="d-close">إغلاق</button></div>`;
    backdrop.style.display='flex'; modal.classList.add('open');
    modal.querySelector('#d-close').addEventListener('click', ()=>{ backdrop.style.display='none'; modal.classList.remove('open');});
    modal.querySelector('#add-debt').addEventListener('click', ()=> openAddDebtModal(debtorId));
    modal.querySelector('#add-payment').addEventListener('click', ()=> openPaymentModal(debtorId));
    modal.querySelector('#print-debtor').addEventListener('click', ()=> printDebtorReceipt(debtorId));
    await renderDebtorDetailArea(debtorId);
  }

  async function renderDebtorDetailArea(debtorId){
    const area = $$('#debtor-detail-area');
    const items = await db.debtItems.where('debtorId').equals(debtorId).toArray();
    const payments = await db.payments.toArray();
    area.innerHTML = '';
    if(items.length===0){ area.innerHTML = '<div class="muted">لا توجد ديون بعد</div>'; return; }
    const table = document.createElement('table');
    table.innerHTML = `<thead><tr><th>الوصف</th><th>المبلغ</th><th>المتبقي</th><th>تاريخ الاستحقاق</th><th></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for(const it of items){
      const paid = payments.filter(p=>p.debtItemId===it.id).reduce((s,p)=>s + Number(p.amount||0),0);
      const left = Number(it.principal||0) - paid;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${it.description || ''}</td><td>${fmtMoney(it.principal,(await safeGet('', )).currency)}</td><td>${fmtMoney(left,(await safeGet('', )).currency)}</td><td>${it.dueDate? new Date(it.dueDate).toLocaleDateString(): '-'}</td><td><div class="table-actions"><button class="btn" data-id="${it.id}" data-act="pay">تسجيل دفعة</button><button class="btn ghost" data-id="${it.id}" data-act="del">حذف</button></div></td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    area.appendChild(table);

    tbody.querySelectorAll('button[data-act="pay"]').forEach(b=>{
      b.addEventListener('click', ()=> openPaymentModal(debtorId, Number(b.dataset.id)));
    });
    tbody.querySelectorAll('button[data-act="del"]').forEach(b=>{
      b.addEventListener('click', async ()=>{
        if(!confirm('حذف الدين؟')) return;
        await db.debtItems.delete(Number(b.dataset.id));
        await audit('delete-debtItem', b.dataset.id);
        renderDebtorDetailArea(debtorId); renderDashboard(); renderDebtors();
      });
    });
  }

  async function openAddDebtModal(debtorId){
    const modal = $$('#modal'), backdrop = $$('#modal-backdrop');
    modal.innerHTML = `<h3>إضافة دين</h3>
      <div style="margin-top:8px"><label>الوصف <input id="di-desc" /></label></div>
      <div class="row" style="margin-top:8px"><div class="col"><label>المبلغ <input id="di-amount" type="number" step="0.01" /></label></div><div class="col"><label>تاريخ الاستحقاق <input id="di-due" type="date" /></label></div></div>
      <div style="margin-top:8px"><label>إنشاء جدول أقساط؟ <input type="checkbox" id="di-installments" /></label></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" id="di-cancel">إلغاء</button><button class="btn" id="di-save">حفظ</button></div>`;
    backdrop.style.display='flex'; modal.classList.add('open');
    modal.querySelector('#di-cancel').addEventListener('click', ()=>{ backdrop.style.display='none'; modal.classList.remove('open');});
    modal.querySelector('#di-save').addEventListener('click', async ()=>{
      const desc = modal.querySelector('#di-desc').value.trim();
      const amount = Number(modal.querySelector('#di-amount').value||0);
      const due = modal.querySelector('#di-due').value? new Date(modal.querySelector('#di-due').value).toISOString(): null;
      if(amount<=0){ alert('أدخل مبلغ صالح'); return; }
      const id = await db.debtItems.add({debtorId, description:desc, principal:amount, dueDate:due});
      await audit('create-debtItem', String(id));
      backdrop.style.display='none'; modal.classList.remove('open');
      renderDebtorDetailArea(debtorId); renderDebtors(); renderDashboard();
      toast('تم إضافة الدين');
    });
  }

  async function openPaymentModal(debtorId, debtItemId=null){
    const modal = $$('#modal'), backdrop = $$('#modal-backdrop');
    modal.innerHTML = `<h3>تسجيل دفعة</h3>
      <div style="margin-top:8px"><label>اختر الدين <select id="p-debt"></select></label></div>
      <div style="margin-top:8px"><label>المبلغ <input id="p-amount" type="number" step="0.01" /></label></div>
      <div style="margin-top:8px"><label>التاريخ <input id="p-date" type="date" value="${new Date().toISOString().slice(0,10)}" /></label></div>
      <div style="margin-top:8px"><label>استلام في حساب <select id="p-account"></select></label></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" id="p-cancel">إلغاء</button><button class="btn" id="p-save">حفظ</button></div>`;
    // fill selects
    const debts = await db.debtItems.where('debtorId').equals(debtorId).toArray();
    const accs = await db.accounts.toArray();
    const settings = await safeGet('', );
    const cur = (settings && settings.currency) ? settings.currency : 'EGP';
    const sel = modal.querySelector('#p-debt');
    debts.forEach(d=>{
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = `${d.description || 'دين'} — ${fmtMoney(d.principal, cur)}`;
      sel.appendChild(o);
    });
    const asel = modal.querySelector('#p-account');
    accs.forEach(a=>{
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name;
      asel.appendChild(o);
    });
    if(debtItemId) sel.value = debtItemId;
    backdrop.style.display='flex'; modal.classList.add('open');
    modal.querySelector('#p-cancel').addEventListener('click', ()=>{ backdrop.style.display='none'; modal.classList.remove('open');});
    modal.querySelector('#p-save').addEventListener('click', async ()=>{
      const di = Number(modal.querySelector('#p-debt').value);
      const amount = Number(modal.querySelector('#p-amount').value||0);
      const date = new Date(modal.querySelector('#p-date').value).toISOString();
      const accountId = Number(modal.querySelector('#p-account').value||0);
      if(amount<=0){ alert('أدخل مبلغ صالح'); return; }
      const pid = await db.payments.add({debtItemId:di, amount, date});
      // create transaction income in account
      if(accountId){
        const txId = await db.transactions.add({date, amount, type:'income', accountId, categoryId:null, note:`سداد ${di}`, relatedDebtorId:debtorId});
        // update account balance (use safeGet)
        const acc = await safeGet('accounts', accountId);
        if(acc) await db.accounts.update(accountId,{balance: Number(acc.balance||0) + amount});
        await audit('create-payment', String(pid));
      }
      backdrop.style.display='none'; modal.classList.remove('open');
      renderDebtorDetailArea(debtorId); renderDebtors(); renderDashboard();
      toast('تم تسجيل الدفعة');
    });
  }

  async function printDebtorReceipt(debtorId){
    const debtor = await safeGet('debtors', debtorId) || {name:'غير معروف'};
    const items = await db.debtItems.where('debtorId').equals(debtorId).toArray();
    const payments = await db.payments.toArray();
    let html = `<html><head><meta charset="utf-8"><title>فاتورة ${debtor.name}</title></head><body><h2>فاتورة ل ${debtor.name}</h2><table border="1" cellpadding="6"><tr><th>الوصف</th><th>المبلغ</th><th>تاريخ الاستحقاق</th><th>مدفوع</th></tr>`;
    for(const it of items){
      const paid = payments.filter(p=>p.debtItemId===it.id).reduce((s,p)=>s + Number(p.amount||0),0);
      html += `<tr><td>${it.description||''}</td><td>${it.principal}</td><td>${it.dueDate? new Date(it.dueDate).toLocaleDateString() : '-'}</td><td>${paid}</td></tr>`;
    }
    html += `</table><p>تاريخ: ${new Date().toLocaleDateString()}</p></body></html>`;
    const w = window.open('','_blank'); w.document.write(html); w.document.close();
  }

  /* ===========================
     Goals
     =========================== */
  $$('#add-goal').addEventListener('click', ()=>openGoalModal());
  async function renderGoals(){
    const list = await db.goals.toArray();
    const el = $$('#goals-list'); el.innerHTML='';
    if(list.length===0){ el.innerHTML='<div class="muted">لا أهداف بعد</div>'; return; }
    const settings = await safeGet('', );
    const cur = (settings && settings.currency) ? settings.currency : 'EGP';
    list.forEach(g=>{
      const wrapper = document.createElement('div'); wrapper.style.marginBottom='10px';
      wrapper.innerHTML = `<div style="display:flex;justify-content:space-between"><div><strong>${g.title}</strong><div class="small">${g.targetDate? 'حتى ' + new Date(g.targetDate).toLocaleDateString() : ''}</div></div><div>${fmtMoney(g.currentAmount, cur)}</div></div><div class="progress" style="margin-top:8px"><i style="width:${Math.min(100, (Number(g.currentAmount||0)/Number(g.targetAmount||1))*100)}%"></i></div>`;
      el.appendChild(wrapper);
    });
  }
  async function openGoalModal(goal=null){
    const modal = $$('#modal'), backdrop=$$('#modal-backdrop');
    modal.innerHTML = `<h3>${goal? 'تعديل هدف' : 'إضافة هدف'}</h3>
      <div style="margin-top:8px"><label>العنوان <input id="g-title"/></label></div>
      <div class="row" style="margin-top:8px"><div class="col"><label>المبلغ المستهدف <input id="g-target" type="number" step="0.01" /></label></div><div class="col"><label>تاريخ الهدف <input id="g-date" type="date" /></label></div></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" id="g-cancel">إلغاء</button><button class="btn" id="g-save">حفظ</button></div>`;
    if(goal){ modal.querySelector('#g-title').value=goal.title; modal.querySelector('#g-target').value=goal.targetAmount; modal.querySelector('#g-date').value = goal.targetDate? goal.targetDate.slice(0,10) : '';}
    backdrop.style.display='flex'; modal.classList.add('open');
    modal.querySelector('#g-cancel').addEventListener('click', ()=>{ backdrop.style.display='none'; modal.classList.remove('open');});
    modal.querySelector('#g-save').addEventListener('click', async ()=>{
      const title = modal.querySelector('#g-title').value.trim();
      const target = Number(modal.querySelector('#g-target').value||0);
      const date = modal.querySelector('#g-date').value? new Date(modal.querySelector('#g-date').value).toISOString():null;
      if(!title || target<=0){ alert('الرجاء إكمال الحقول'); return; }
      if(goal) await db.goals.update(goal.id,{title,targetAmount:target,targetDate:date});
      else await db.goals.add({title,targetAmount:target,currentAmount:0,targetDate:date});
      backdrop.style.display='none'; modal.classList.remove('open');
      renderGoals(); toast('تم حفظ الهدف');
    });
  }

  /* ===========================
     Reports & Export/Import
     =========================== */
  $$('#report-generate').addEventListener('click', renderReports);
  $$('#report-export-csv').addEventListener('click', ()=> exportReportCSV());
  $$('#export-json').addEventListener('click', ()=> exportFullJSON());
  $$('#import-json').addEventListener('click', ()=> { const inp = document.createElement('input'); inp.type='file'; inp.accept='.json'; inp.onchange = async (e)=> importFullJSON(e.target.files[0]); inp.click(); });
  $$('#btn-backup-now').addEventListener('click', ()=> exportFullJSON());
  $$('#btn-restore').addEventListener('click', ()=> { const inp = document.createElement('input'); inp.type='file'; inp.accept='.json'; inp.onchange = async (e)=> importFullJSON(e.target.files[0]); inp.click(); });

  // ...existing code...
  async function renderReports(){
    const from = $$('#report-from').value ? new Date($$('#report-from').value) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = $$('#report-to').value ? new Date($$('#report-to').value) : new Date();
    const txns = await db.transactions.toArray();
    const filtered = txns.filter(t=>{
      const d = new Date(t.date);
      return d>=from && d<=to;
    });
    const area = $$('#report-area'); area.innerHTML = '';
    const table = document.createElement('table');  
    table.innerHTML = `<thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th><th>الحساب</th><th>الفئة</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    const settings = await safeGet('', );
    const currency = (settings && settings.currency) ? settings.currency : 'EGP';
    for(const t of filtered){
      const a = await safeGet('accounts', t.accountId);
      const c = await safeGet('categories', t.categoryId);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${new Date(t.date).toLocaleString()}</td><td>${t.note||t.description||''}</td><td>${fmtMoney(t.amount,currency)}</td><td>${a? a.name : ''}</td><td>${c? c.name : ''}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    area.appendChild(table);
  }

async function exportReportCSV(){
    const txns = await db.transactions.toArray();
    const csv = ['date,description,amount,account,category'];
    for(const t of txns){
      const a = await safeGet('accounts', t.accountId);
      const c = await safeGet('categories', t.categoryId);
      csv.push(`"${t.date}","${(t.note||'').replace(/"/g,'""')}",${t.amount},"${a? a.name : ''}","${c? c.name : ''}"`);
    }
    const blob = new Blob([csv.join('\\n')], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download = 'report.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  /* Full export/import with optional encryption */
  async function exportFullJSON(){
    const settings = await safeGet('', );
    const dump = {};
    for(const table of ['accounts','transactions','categories','budgets','debtors','debtItems','payments','recurring','goals','audit']){
      dump[table] = await db[table].toArray();
    }
    dump.settings = settings;
    const raw = JSON.stringify(dump,null,2);
    if(settings && settings.encrypt){
      const pass = prompt('أدخل كلمة مرور لتشفير النسخة الاحتياطية:');
      if(!pass) return alert('لا يمكن إنشاء نسخة مشفرة بدون كلمة مرور');
      const enc = await encryptString(pass, raw);
      downloadFile(JSON.stringify({encrypted:true, payload: enc}), 'finance-backup-encrypted.json');
    } else {
      downloadFile(raw, 'finance-backup.json');
    }
    toast('تم تنزيل النسخة الاحتياطية');
  }

  async function importFullJSON(file){
    if(!file) return;
    const text = await file.text();
    let data = null;
    try { data = JSON.parse(text); } catch(e){ alert('ملف غير صالح'); return; }
    if(data.encrypted && data.payload){
      const pass = prompt('أدخل كلمة مرور فك التشفير:');
      if(!pass) return;
      try {
        const plain = await decryptString(pass, data.payload);
        data = JSON.parse(plain);
      } catch(e){ alert('فشل فك التشفير'); return; }
    }
    if(!data || !data.accounts){ alert('ملف النسخة الاحتياطية غير صالح'); return; }
    if(!confirm('سيتم استبدال البيانات الحالية. متابعة؟')) return;
    // clear and import
    for(const t of ['accounts','transactions','categories','budgets','debtors','debtItems','payments','recurring','goals','audit']){
      await db[t].clear();
      if(Array.isArray(data[t])) await db[t].bulkAdd(data[t]);
    }
    if(data.settings) await db.settings.put(Object.assign({id:1}, data.settings));
    await audit('import-full', file.name);
    toast('تم الاستيراد'); renderDashboard(); renderTransactions(); renderAccounts(); renderDebtors(); renderCategories();
  }

  function downloadFile(content, filename){
    const blob = new Blob([content], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  /* ===========================
     Simple encryption helpers (Web Crypto)
     PBKDF2 + AES-GCM
     =========================== */
  async function getKeyMaterial(password){
    const enc = new TextEncoder();
    return await window.crypto.subtle.importKey('raw', enc.encode(password), {name:'PBKDF2'}, false, ['deriveKey']);
  }
  async function deriveKey(password, salt){
    const keyMat = await getKeyMaterial(password);
    return await window.crypto.subtle.deriveKey({
      name:'PBKDF2',
      salt: (new TextEncoder()).encode(salt),
      iterations: 250000,
      hash:'SHA-256'
    },{
      name:'AES-GCM',
      length:256
    }, false, ['encrypt','decrypt']);
  }
  async function encryptString(password, plain){
    const salt = uid();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const enc = new TextEncoder();
    const ct = await window.crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(plain));
    return JSON.stringify({salt,iv: Array.from(iv), ct: Array.from(new Uint8Array(ct))});
  }
  async function decryptString(password, payload){
    const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const iv = new Uint8Array(obj.iv);
    const ct = new Uint8Array(obj.ct);
    const key = await deriveKey(password, obj.salt);
    const plain = await window.crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
    return new TextDecoder().decode(plain);
  }

  /* ===========================
     Settings
     =========================== */
  async function renderSettings(){
    const s = (await safeGet('', )) || {currency:'EGP',encrypt:false};
    $$('#setting-currency').value = s.currency || 'EGP';
    $$('#setting-encrypt').checked = s.encrypt || false;
    $$('#setting-encrypt').addEventListener('change', async ()=>{
      const checked = $$('#setting-encrypt').checked;
      await db.settings.update(1,{encrypt: checked});
      toast('تم تحديث الإعدادات');
    });
    $$('#setting-currency').addEventListener('change', async ()=>{
      const cur = $$('#setting-currency').value.trim() || 'EGP';
      await db.settings.update(1,{currency:cur});
      toast('تم حفظ العملة');
    });
  }
  /* ===========================
     Service Worker register (PWA)
     =========================== */
  // Only attempt to register the service worker on supported protocols (avoid file://)
  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.protocol === 'http:')){
    navigator.serviceWorker.register('sw.js').then(()=> console.log('sw registered')).catch(e=>console.warn('sw failed', e));
  } else {
    console.log('serviceWorker not registered due to unsupported protocol or environment');
  }

  /* Initialize app data sample on first run (only if empty) */
  async function seedIfEmpty(){
    const cnt = await db.accounts.count();
    if(cnt===0){
      await db.accounts.bulkAdd([
        {name:'النقد', type:'cash', currency:'EGP', balance:1500},
        {name:'الحساب البنكي', type:'bank', currency:'EGP', balance:5000},
      ]);
      await db.categories.bulkAdd([
        {name:'مأكل'}, {name:'سكن'}, {name:'مواصلات'}, {name:'ترفيه'}
      ]);
      await db.transactions.bulkAdd([
        {date: new Date().toISOString(), amount:500, type:'expense', accountId:1, categoryId:1, note:'شراء بقالة'},
        {date: new Date().toISOString(), amount:1200, type:'income', accountId:2, categoryId:null, note:'راتب'}
      ]);
    }
  }
  seedIfEmpty();

  // initial view
  showView('dashboard');

  // quick hooks
  // basic search
  // ...existing code...
  // basic search
  $$('#txn-search').addEventListener('input', async (e)=>{
    const q = e.target.value.toLowerCase();
    const txns = await db.transactions.toArray();
    const filtered = txns.filter(t=> (t.note||'').toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q) );
    const body = $$('#txns-table-body'); body.innerHTML='';
    const settings = await safeGet('', );
    const currency = (settings && settings.currency) ? settings.currency : 'EGP';
    for(const t of filtered) {
      const acc = await safeGet('accounts', t.accountId);
      const cat = await safeGet('categories', t.categoryId);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${new Date(t.date).toLocaleString()}</td><td>${t.note||''}</td><td>${cat? cat.name : ''}</td><td>${acc? acc.name:''}</td><td style="text-align:left">${fmtMoney(t.amount,currency)}</td><td></td>`;
      body.appendChild(tr);
    }
  });

  // initial render calls for other lists
  renderAccounts(); renderTransactions(); renderCategories(); renderDebtors(); renderGoals();

// global handler to capture remaining promise rejections and aid debugging
window.addEventListener('unhandledrejection', e=>{
  console.error('Unhandled rejection (global):', e.reason, e);
});

/* Add PWA install prompt handling + small mobile helpers */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $$('#btn-install');
  if(btn) btn.style.display = 'inline-block';
});

const installBtn = $$('#btn-install');
if(installBtn){
  installBtn.addEventListener('click', async ()=>{
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice.catch(()=>({outcome:'dismissed'}));
    deferredPrompt = null;
    installBtn.style.display = 'none';
    if(choice && choice.outcome === 'accepted') toast('تم تثبيت التطبيق');
    else toast('تم إلغاء تثبيت التطبيق');
  });
}

// responsive: add class to sidebar so CSS uses fixed bottom layout (already styled)
function updateSidebarMobile(){
  const sidebar = $$('#sidebar');
  if(!sidebar) return;
  if(window.innerWidth <= 600) sidebar.classList.add('mobile-bottom');
  else sidebar.classList.remove('mobile-bottom');
}
window.addEventListener('resize', updateSidebarMobile);
window.addEventListener('orientationchange', updateSidebarMobile);
document.addEventListener('DOMContentLoaded', updateSidebarMobile);
updateSidebarMobile();

/* Enhance modal sizing on small screens (apply class when opened) */
const modalEl = $$('#modal');
const backdropEl = $$('#modal-backdrop');
function adaptModalForMobile(modal){
  if(!modal) return;
  if(window.innerWidth <= 600) modal.classList.add('fullscreen');
  else modal.classList.remove('fullscreen');
  // make backdrop tappable to close
  backdropEl.addEventListener('click', (ev)=>{
    if(ev.target === backdropEl){
      backdropEl.style.display='none';
      modal.classList.remove('open');
    }
  }, {once:true});
}

/* Replace occurrences where modal is shown to adapt automatically.
   Call adaptModalForMobile(modal) before adding open/display — existing modal open calls remain but this helper will be applied in key places.
*/
const originalOpenTxnModal = openTxnModal;
openTxnModal = async function(txn=null){
  const ret = await originalOpenTxnModal(txn);
  adaptModalForMobile($$('#modal'));
  return ret;
};

const originalOpenAccountModal = openAccountModal;
openAccountModal = async function(acc=null){
  const ret = await originalOpenAccountModal(acc);
  adaptModalForMobile($$('#modal'));
  return ret;
};

const originalOpenCategoryModal = openCategoryModal;
openCategoryModal = async function(cat=null){
  const ret = await originalOpenCategoryModal(cat);
  adaptModalForMobile($$('#modal'));
  return ret;
};

const originalOpenDebtorModal = openDebtorModal;
openDebtorModal = async function(d=null){
  const ret = await originalOpenDebtorModal(d);
  adaptModalForMobile($$('#modal'));
  return ret;
};

const originalOpenDebtorDetailModal = openDebtorDetailModal;
openDebtorDetailModal = async function(id){
  const ret = await originalOpenDebtorDetailModal(id);
  adaptModalForMobile($$('#modal'));
  return ret;
};

const originalOpenAddDebtModal = openAddDebtModal;
openAddDebtModal = async function(id){
  const ret = await originalOpenAddDebtModal(id);
  adaptModalForMobile($$('#modal'));
  return ret;
};

const originalOpenPaymentModal = openPaymentModal;
openPaymentModal = async function(debtorId, debtItemId=null){
  const ret = await originalOpenPaymentModal(debtorId, debtItemId);
  adaptModalForMobile($$('#modal'));
  return ret;
};

const originalOpenGoalModal = openGoalModal;
openGoalModal = async function(g=null){
  const ret = await originalOpenGoalModal(g);
  adaptModalForMobile($$('#modal'));
  return ret;
};
