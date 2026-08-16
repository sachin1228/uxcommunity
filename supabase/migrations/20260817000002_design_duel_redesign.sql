-- ============================================================
-- Design Duel — apply redesigned starting designs to existing
-- databases.
--
-- The seed migration (20260817000001) only affects fresh
-- installs. This UPDATE patches the two redesigned starting
-- designs (checkout + banking) onto rows that already exist,
-- keyed by slug so it is safe to re-run.
--
-- The JSON values below are byte-identical to the ones in the
-- seed migration.
-- ============================================================

update public.design_duel_challenges
set starting_design = '{"frame":{"width":375,"height":812},"components":[
    {"id":"status","type":"text","x":24,"y":56,"width":200,"height":32,"text":"Checkout","fontSize":22,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"sub","type":"text","x":24,"y":92,"width":327,"height":18,"text":"Rajdhani Family Restaurant · 25-30 min","fontSize":13,"fontWeight":400,"color":"#666666","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"input-addr","type":"input","x":24,"y":126,"width":327,"height":60,"text":"Deliver to · 4th Cross, Indiranagar","fontSize":15,"fontWeight":400,"color":"#111111","background":"#F7F7F7","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"card-items","type":"card","x":24,"y":202,"width":327,"height":140,"text":"2x Chicken Biryani   ₹498\n1x Mango Lassi      ₹99\n1x Garlic Naan       ₹49","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":16,"padding":16,"align":"left","opacity":1},
    {"id":"bill-card","type":"card","x":24,"y":358,"width":327,"height":172,"text":"Item total           ₹646\nDelivery fee         ₹40\nPackaging fee       ₹12\nGST                      ₹58\n\nTo pay                 ₹756","fontSize":14,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":16,"padding":16,"align":"left","opacity":1},
    {"id":"label-pay","type":"text","x":24,"y":546,"width":200,"height":20,"text":"Payment method","fontSize":14,"fontWeight":600,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"pm-upi","type":"card","x":24,"y":578,"width":99,"height":52,"text":"UPI","fontSize":14,"fontWeight":600,"color":"#111111","background":"#F7F7F7","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"pm-card","type":"card","x":138,"y":578,"width":99,"height":52,"text":"Card","fontSize":14,"fontWeight":600,"color":"#111111","background":"#F7F7F7","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"pm-cash","type":"card","x":252,"y":578,"width":99,"height":52,"text":"Cash","fontSize":14,"fontWeight":600,"color":"#111111","background":"#F7F7F7","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"card-pay","type":"card","x":24,"y":646,"width":327,"height":44,"text":"Apply coupon · SAVE20","fontSize":13,"fontWeight":500,"color":"#B7791F","background":"#FFF8E6","radius":12,"padding":12,"align":"left","opacity":1},
    {"id":"btn-pay","type":"button","x":24,"y":700,"width":327,"height":56,"text":"Pay Now","fontSize":16,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1}
   ]}'::jsonb
where slug = 'checkout-001';

update public.design_duel_challenges
set starting_design = '{"frame":{"width":375,"height":812},"components":[
    {"id":"title","type":"text","x":24,"y":64,"width":240,"height":32,"text":"Good morning, Rahul","fontSize":22,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"card-bal","type":"card","x":24,"y":112,"width":327,"height":150,"text":"","fontSize":14,"fontWeight":400,"color":"#FFFFFF","background":"#0A0A0A","radius":20,"padding":0,"align":"left","opacity":1},
    {"id":"bal-label","type":"text","x":44,"y":138,"width":200,"height":18,"text":"Total balance","fontSize":13,"fontWeight":500,"color":"#A9B4C4","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"bal-amount","type":"text","x":44,"y":160,"width":240,"height":40,"text":"₹1,84,520","fontSize":30,"fontWeight":700,"color":"#FFFFFF","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"bal-sub","type":"text","x":44,"y":216,"width":240,"height":18,"text":"+₹2,340 this month","fontSize":13,"fontWeight":500,"color":"#10B981","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"btn-send","type":"button","x":24,"y":286,"width":156,"height":56,"text":"Send","fontSize":15,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"btn-request","type":"button","x":195,"y":286,"width":156,"height":56,"text":"Request","fontSize":15,"fontWeight":600,"color":"#111111","background":"#F5F5F5","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"btn-recharge","type":"button","x":24,"y":354,"width":156,"height":56,"text":"Recharge","fontSize":15,"fontWeight":600,"color":"#111111","background":"#F5F5F5","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"btn-scan","type":"button","x":195,"y":354,"width":156,"height":56,"text":"Scan & Pay","fontSize":15,"fontWeight":600,"color":"#111111","background":"#F5F5F5","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"label-recent","type":"text","x":24,"y":438,"width":200,"height":24,"text":"Recent activity","fontSize":16,"fontWeight":600,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"row1","type":"card","x":24,"y":470,"width":327,"height":68,"text":"Sent to Ankit   ₹2,000","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1},
    {"id":"row2","type":"card","x":24,"y":550,"width":327,"height":68,"text":"Received from Priya   ₹5,400","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1},
    {"id":"row3","type":"card","x":24,"y":630,"width":327,"height":68,"text":"Bill payment   ₹820","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1}
   ]}'::jsonb
where slug = 'banking-001';
