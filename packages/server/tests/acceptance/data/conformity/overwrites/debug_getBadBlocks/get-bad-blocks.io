// gets the list of bad blocks known to the node using debug_getBadBlocks
//
// Custom test: this is not an override of a test from the execution-apis repository.
// Reason: the execution-apis test suite does not define a canonical debug_getBadBlocks
// case, but we still want to verify that the relay correctly exposes the method.
// In our environment, no bad blocks are expected, so the result must be an empty array.

>> {"jsonrpc":"2.0","id":1,"method":"debug_getBadBlocks","params":[]}
<< {"jsonrpc":"2.0","id":1,"result":[]}
