grammar WaasDsl

hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;

entry Model: (elements+=(Workflow | Template));

Workflow:
    'workflow' name=ID '{'
        ('version' ':' version=INT)?
        ('description' ':' description=STRING)?
        ('inputs' ':' inputs=Arrays)?
        (tasks+=Task_Or_Code)*
    '}';

Template:
    'template' name=ID '{'
        ('inputs' ':' inputs=Arrays)
        (tasks+=Task_Or_Code)*
        ('return' returns=JSON_Object)?
    '}';

Task:
    (variablename=ID '=')? 'run' task_name=ID '{' (blocks+=Task_Data)+ '}'; 

Task_Composition:
    (variablename=ID '=')? 'call' template_name=ID inputs=JSON_Object;

Task_Data:
    'type' ':' type=ID |
    'timeout' ':' timeout=STRING | 
    'retries' ':' retries=INT |
    'payload' ':' payload=JSON_Object;

JSON_Object:
    '{' (key+=JSON_Value ':' value+=ANY_VALUE) (',' (key+=JSON_Value ':' value+=ANY_VALUE))* ','? '}';

Arrays:
    '[' (elements+=ID) (',' elements+=ID)* ','? ']';

Code_Block:
    'parallel' '{' (parallel_blocks+=Task_Or_Code)+ '}' |
    'if' '(' condition=Conditional_Expression ')' '{' (condition_blocks+=Task_Or_Code)+ '}' ('else' '{' (else_blocks+=Task_Or_Code)+ '}')?;

Task_Or_Code : 
    Task | Code_Block | Task_Composition;

Conditional_Expression:
    left=ANY_VALUE operator=Conditional_Operator right=ANY_VALUE;

JSON_Value:
    name=(ID | 'inputs') ('.' member=ID)?;

ANY_VALUE:
    STRING | INT | JSON_Value | JSON_Object;

Conditional_Operator returns string:
    '==' | '!=' | '>' | '<' | '>=' | '<=';