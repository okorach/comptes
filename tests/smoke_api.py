import sys, os, json, threading, time, urllib.request, base64
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from comptes import server
sys.argv = ["x", "8766"]
threading.Thread(target=server.main, daemon=True).start(); time.sleep(1)
B = "http://127.0.0.1:8766"
def call(m, p, d=None):
    r = urllib.request.Request(B + p, method=m, data=None if d is None else json.dumps(d).encode(), headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e:
        return {"HTTP": e.code, "body": e.read().decode()[:200]}
acc = "BoursoBank Olivier"
n0 = len(call("GET", "/api/account/BoursoBank%20Olivier/transactions?limit=5000"))
tid = call("POST", "/api/account/BoursoBank%20Olivier/transactions", {"date": "2026-10-18", "native_amount": "-12,50", "description": "TEST", "subcategory": "Loisirs"})
print("added", tid)
t = call("GET", "/api/account/BoursoBank%20Olivier/transactions?limit=2")
print(t[0]["description"], t[0]["amount_eur"], t[0]["balance_eur"], "prev bal", t[1]["balance_eur"])
print("del", call("DELETE", f"/api/transaction/{tid['id']}"), len(call("GET", "/api/account/BoursoBank%20Olivier/transactions?limit=5000")) == n0)
sp = call("GET", "/api/spending?group=month&months=24")
print("spending months", len(sp["series"]), sp["series"][-2:], sp["categories"][:3])
print("year", [ (s['period'], s['spread']) for s in call("GET", "/api/spending?group=year&months=60")["series"]])
print("interests rows", len(call("GET", "/api/interests")), call("POST", "/api/interests/recalc", {"account": "PEE Volvo"}))
print(call("GET", "/api/account/PEE%20Volvo")["interests"])
data = "2026-10-01;x;PAIEMENT PAR CARTE TEST;a;b;c;-3,10;;00040786856;x\n".encode()
hdr = "h1;h2;h3;h4;h5;h6;h7;h8;h9;h10\n".encode()
print(call("POST", "/api/account/BoursoBank%20Olivier/import", {"filename": "a.csv", "data": base64.b64encode(hdr + data).decode()}))
print(call("GET", "/api/meta")["currencies"], call("GET", "/api/fx?currency=CHF")[:1])
