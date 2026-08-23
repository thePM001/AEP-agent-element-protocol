//! Aho-Corasick automaton. One pass over the haystack for all literals.
//! @PAD: aep-sdk-dynaep-aho
//! @GCDE: gaplune.code.v1

use std::collections::VecDeque;

#[derive(Clone)]
struct Node {
    next: [i32; 256],
    fail: i32,
    out: Vec<usize>,
}

impl Node {
    fn new() -> Self {
        Self { next: [-1; 256], fail: 0, out: Vec::new() }
    }
}

pub struct AhoCorasick {
    nodes: Vec<Node>,
    pats: Vec<String>,
}

impl AhoCorasick {
    pub fn new(patterns: &[String]) -> Self {
        let mut nodes = vec![Node::new()];
        for (i, p) in patterns.iter().enumerate() {
            let mut s = 0i32;
            for b in p.as_bytes() {
                let b = *b as usize;
                if nodes[s as usize].next[b] < 0 {
                    let n = nodes.len() as i32;
                    nodes[s as usize].next[b] = n;
                    nodes.push(Node::new());
                }
                s = nodes[s as usize].next[b];
            }
            nodes[s as usize].out.push(i);
        }
        let mut q = VecDeque::new();
        for b in 0..256 {
            if nodes[0].next[b] >= 0 {
                q.push_back(nodes[0].next[b]);
            } else {
                nodes[0].next[b] = 0;
            }
        }
        while let Some(u) = q.pop_front() {
            for b in 0..256 {
                let v = nodes[u as usize].next[b];
                if v >= 0 {
                    nodes[v as usize].fail = nodes[nodes[u as usize].fail as usize].next[b];
                    let f = nodes[v as usize].fail as usize;
                    let extra = nodes[f].out.clone();
                    nodes[v as usize].out.extend(extra);
                    q.push_back(v);
                } else {
                    nodes[u as usize].next[b] = nodes[nodes[u as usize].fail as usize].next[b];
                }
            }
        }
        Self { nodes, pats: patterns.to_vec() }
    }

    pub fn find(&self, text: &str) -> Vec<(usize, usize, usize)> {
        let mut s = 0i32;
        let mut hits = Vec::new();
        for (i, b) in text.as_bytes().iter().enumerate() {
            s = self.nodes[s as usize].next[*b as usize];
            for &pi in &self.nodes[s as usize].out {
                let len = self.pats[pi].len();
                hits.push((pi, i + 1 - len, i + 1));
            }
        }
        hits
    }
}
